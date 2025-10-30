/**
 * Main Cloudflare Worker handler for sitemap merger
 */

import { Env, SitemapUrl, WebflowWebhookPayload } from './types';
import { parseSitemap } from './sitemap-parser';
import { SubdomainTransformer } from './url-transformer';
import {
  buildSitemapXml,
  validateUrlsAreWwwOnly,
} from './sitemap-builder';
import {
  validateWebhookSignature,
  getWebhookSecret,
} from './webhook-validator';

const KV_CACHE_KEY = 'merged_sitemap';
const KV_CACHE_TIMESTAMP_KEY = 'merged_sitemap_timestamp';

/**
 * Protected paths that should NOT be deduplicated - these are exact root-level paths
 * that should exist in both main site and city-transformed versions
 */
const PROTECTED_PATHS = [
  '/',                    // Root URL
  '/city-by-urban',       // City section root
  '/venues', 
  '/private-hire', 
  '/whats-on',
  '/christmas',
  '/bookings',
  '/contact'
] as const;

/**
 * Exception patterns - paths containing these should NOT be deduplicated
 */
const PROTECTED_PATH_PATTERNS = [
  '/bookings/all-sites',  // Special exception for all-sites bookings
] as const;

const WWW_DOMAIN = 'www.urbanpubsandbars.com';
const BASE_URL = `https://${WWW_DOMAIN}`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // Log all incoming requests for debugging
    console.log(`[${request.method}] ${url.pathname} - Host: ${url.hostname}`);

    // Webhook endpoint for cache invalidation
    if (
      url.pathname === '/webhook/sitemap-invalidate' &&
      request.method === 'POST'
    ) {
      return handleWebhookInvalidation(request, env);
    }

    // Main sitemap endpoint
    if (url.pathname === '/sitemap.xml' && request.method === 'GET') {
      return handleSitemapRequest(env);
    }

    // Handle paginated sitemaps (if > 50k URLs)
    if (
      url.pathname.startsWith('/sitemap-') &&
      url.pathname.endsWith('.xml') &&
      request.method === 'GET'
    ) {
      // For now, return main sitemap (pagination can be added later)
      return handleSitemapRequest(env);
    }

    return new Response('Not Found', { status: 404 });
  },
};

/**
 * Handle sitemap request - check cache, fetch if needed, return merged sitemap
 */
async function handleSitemapRequest(env: Env): Promise<Response> {
  try {
    console.log('Sitemap request received - checking cache...');
    // Check KV cache first
    const cached = await env.SITEMAP_CACHE.get(KV_CACHE_KEY);
    if (cached) {
      const timestamp = await env.SITEMAP_CACHE.get(KV_CACHE_TIMESTAMP_KEY);
      if (timestamp) {
        const cacheAge = Date.now() - parseInt(timestamp, 10);
        // Use cached sitemap if less than 24 hours old
        if (cacheAge < 24 * 60 * 60 * 1000) {
          console.log(`Returning cached sitemap (age: ${Math.round(cacheAge / 1000 / 60)} minutes)`);
          return new Response(cached, {
            headers: {
              'Content-Type': 'application/xml',
              'Cache-Control': 'public, max-age=3600',
            },
          });
        }
      }
    }

    // Cache miss or expired - fetch fresh sitemaps
    console.log('Cache miss or expired - generating fresh sitemap...');
    const mergedSitemap = await generateMergedSitemap(env);

    // Store in cache
    await env.SITEMAP_CACHE.put(KV_CACHE_KEY, mergedSitemap);
    await env.SITEMAP_CACHE.put(
      KV_CACHE_TIMESTAMP_KEY,
      Date.now().toString()
    );

    return new Response(mergedSitemap, {
      headers: {
        'Content-Type': 'application/xml',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    console.error('Error handling sitemap request:', errorMessage, errorStack);
    return new Response(
      `Internal Server Error: Unable to generate sitemap\n\nError: ${errorMessage}\n\nStack: ${errorStack}`,
      {
        status: 503,
        headers: { 'Content-Type': 'text/plain' },
      }
    );
  }
}

/**
 * Check if a path is a protected path (exact match only)
 */
function isProtectedPath(path: string): boolean {
  return PROTECTED_PATHS.includes(path as any);
}

/**
 * Check if a path matches any protected path patterns
 */
function matchesProtectedPattern(path: string): boolean {
  return PROTECTED_PATH_PATTERNS.some(pattern => path.includes(pattern));
}

/**
 * Check if a URL is the root URL
 */
function isRootUrl(url: string, path: string): boolean {
  return (
    path === '/' || 
    path === '' || 
    url === BASE_URL || 
    url === `${BASE_URL}/`
  );
}

/**
 * Result type for deduplication with tracking
 */
interface DeduplicationResult {
  urls: SitemapUrl[];
  removedUrls: Array<{
    removed: string;
    kept: string;
    reason: string;
  }>;
}

/**
 * Remove duplicate main site URLs where city-transformed version exists
 * 
 * If both /venues/fleets and /city-by-urban/venues/fleets exist,
 * remove /venues/fleets (keep the more specific city version)
 * 
 * Excludes primary paths like /venues and /private-hire from deduplication
 */
function removeDuplicateMainSiteUrls(urls: SitemapUrl[], trackRemovals = false): SitemapUrl[] | DeduplicationResult {
  console.log(`Starting deduplication with ${urls.length} URLs`);
  
  const removedUrls: Array<{ removed: string; kept: string; reason: string }> = [];
  
  // Extract city-by-urban paths (without the prefix) that aren't protected
  const cityPaths = new Set<string>();
  const cityUrlsMap = new Map<string, SitemapUrl>();
  
  for (const url of urls) {
    try {
      const urlObj = new URL(url.loc);
      const path = urlObj.pathname;
      
      // Check if this is a city-transformed URL
      if (path.startsWith('/city-by-urban/')) {
        // Extract the path after /city-by-urban/
        const cityPath = path.replace('/city-by-urban', '');
        
        // Don't track protected paths as duplicate candidates
        // These should always be kept in both main and city versions
        if (isProtectedPath(cityPath)) {
          continue;
        }
        
        // Track all city paths that are NOT protected paths
        // (sub-paths of protected paths can still be deduplicated, e.g., /bookings/fleets)
        cityPaths.add(cityPath);
        cityUrlsMap.set(cityPath, url);
      }
    } catch (e) {
      console.warn(`Error processing URL in deduplication: ${url.loc}`, e);
    }
  }
  
  console.log(`Found ${cityPaths.size} city paths to check for duplicates`);
  
  // Filter out main site URLs that have a corresponding city version
  const filtered = urls.filter((url) => {
    try {
      const urlObj = new URL(url.loc);
      const path = urlObj.pathname;
      
      // Always keep city-transformed URLs
      if (path.startsWith('/city-by-urban/')) {
        return true;
      }
      
      // Always keep root URL
      if (isRootUrl(url.loc, path)) {
        return true;
      }
      
      // Always keep protected paths
      if (isProtectedPath(path)) {
        return true;
      }
      
      // Always keep paths matching protected patterns
      if (matchesProtectedPattern(path)) {
        return true;
      }
      
      // Remove if there's a corresponding city version
      if (cityPaths.has(path)) {
        const keptUrl = cityUrlsMap.get(path);
        if (trackRemovals) {
          removedUrls.push({
            removed: url.loc,
            kept: keptUrl?.loc || 'unknown',
            reason: 'Duplicate: city version exists'
          });
        }
        console.log(`Removing duplicate: ${url.loc} (city version exists: ${keptUrl?.loc})`);
        return false;
      }
      
      return true;
    } catch (e) {
      console.warn(`Error filtering URL: ${url.loc}`, e);
      return true; // Keep on error
    }
  });
  
  const removedCount = urls.length - filtered.length;
  if (removedCount > 0) {
    console.log(`Deduplication: Removed ${removedCount} duplicate main site URLs`);
  } else {
    console.log(`Deduplication: No duplicates found to remove`);
  }
  
  if (trackRemovals) {
    return { urls: filtered, removedUrls };
  }
  
  return filtered;
}

/**
 * Generate merged sitemap from all three sources
 */
async function generateMergedSitemap(env: Env): Promise<string> {
  const transformer = new SubdomainTransformer(env.PATH_MAPPINGS);

  // Fetch all three sitemaps in parallel
  const [mainResult, cityResult, careersResult] = await Promise.allSettled([
    fetchSitemap(env.MAIN_SITEMAP_URL, 'main', transformer),
    fetchSitemap(env.CITY_SITEMAP_URL, 'city', transformer),
    fetchSitemap(env.CAREERS_SITEMAP_URL, 'careers', transformer),
  ]);

  // Collect all URLs (with graceful degradation)
  const allUrls: SitemapUrl[] = [];

  if (mainResult.status === 'fulfilled') {
    const mainUrls = mainResult.value;
    allUrls.push(...mainUrls);
    console.log(`✓ Main sitemap: ${mainUrls.length} URLs`);
    if (mainUrls.length === 0) {
      console.error('⚠️ WARNING: Main sitemap returned 0 URLs! This should not happen.');
    } else {
      console.log(`  Sample main URLs: ${mainUrls.slice(0, 3).map(u => u.loc).join(', ')}`);
    }
  } else {
    const reason = mainResult.reason instanceof Error ? mainResult.reason.message : String(mainResult.reason);
    console.error('✗ Failed to fetch main sitemap:', reason);
  }

  if (cityResult.status === 'fulfilled') {
    allUrls.push(...cityResult.value);
    console.log(`✓ City sitemap: ${cityResult.value.length} URLs`);
  } else {
    const reason = cityResult.reason instanceof Error ? cityResult.reason.message : String(cityResult.reason);
    console.error('✗ Failed to fetch city sitemap:', reason);
  }

  if (careersResult.status === 'fulfilled') {
    allUrls.push(...careersResult.value);
    console.log(`✓ Careers sitemap: ${careersResult.value.length} URLs`);
  } else {
    const reason = careersResult.reason instanceof Error ? careersResult.reason.message : String(careersResult.reason);
    console.error('✗ Failed to fetch careers sitemap:', reason);
  }

  // If all sources failed, throw error
  if (allUrls.length === 0) {
    const errors = [
      mainResult.status === 'rejected' ? `Main: ${mainResult.reason}` : null,
      cityResult.status === 'rejected' ? `City: ${cityResult.reason}` : null,
      careersResult.status === 'rejected' ? `Careers: ${careersResult.reason}` : null,
    ].filter(Boolean).join('; ');
    throw new Error(`All sitemap sources failed: ${errors}`);
  }

  // Remove duplicate URLs where city-transformed version exists
  const deduplicatedUrls = removeDuplicateMainSiteUrls(allUrls) as SitemapUrl[];

  // Final SEO validation: ensure all URLs are www domain only
  const { valid, invalid } = validateUrlsAreWwwOnly(deduplicatedUrls);

  if (invalid.length > 0) {
    console.warn(
      `Filtered out ${invalid.length} invalid URLs during final validation`
    );
  }

  // Final safety check: ensure all protected paths are in the final sitemap
  // These are critical paths that should always be present
  // Build required paths from PROTECTED_PATHS constant
  const requiredProtectedPaths = PROTECTED_PATHS.map(path => ({
    path,
    url: `${BASE_URL}${path}`,
  }));
  
  /**
   * Normalize path for comparison (handles trailing slashes)
   */
  const normalizePath = (pathname: string): string => {
    if (pathname === '/' || pathname === '') return '/';
    return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  };

  // Ensure main site versions exist
  for (const { path, url } of requiredProtectedPaths) {
    const normalizedPath = normalizePath(path);
    const exists = valid.some(u => {
      try {
        const urlObj = new URL(u.loc);
        const normalized = normalizePath(urlObj.pathname);
        return normalized === normalizedPath && urlObj.hostname === WWW_DOMAIN && !u.loc.includes('/city-by-urban');
      } catch {
        // Fallback: check if URL matches (with or without trailing slash)
        return normalizePath(url) === normalizePath(u.loc);
      }
    });
    
    if (!exists) {
      console.log(`Adding missing protected path: ${path}`);
      valid.unshift({ loc: url });
    }
  }
  
  // Also ensure city versions exist for protected paths (except /city-by-urban itself)
  const cityProtectedPaths = requiredProtectedPaths.filter(p => p.path !== '/city-by-urban');
  for (const { path } of cityProtectedPaths) {
    const cityUrl = `${BASE_URL}/city-by-urban${path}`;
    const normalizedCityPath = normalizePath(`/city-by-urban${path}`);
    const exists = valid.some(u => {
      try {
        const urlObj = new URL(u.loc);
        return normalizePath(urlObj.pathname) === normalizedCityPath;
      } catch {
        return normalizePath(u.loc) === normalizePath(cityUrl);
      }
    });
    
    if (!exists) {
      console.log(`Adding missing city protected path: ${path}`);
      // Find where to insert (after main version)
      const mainIndex = valid.findIndex(u => {
        try {
          const urlObj = new URL(u.loc);
          const normalized = normalizePath(urlObj.pathname);
          return normalized === normalizePath(path) && urlObj.hostname === WWW_DOMAIN && !u.loc.includes('/city-by-urban');
        } catch {
          return false;
        }
      });
      if (mainIndex >= 0) {
        valid.splice(mainIndex + 1, 0, { loc: cityUrl });
      } else {
        valid.push({ loc: cityUrl });
      }
    }
  }

  if (valid.length === 0) {
    throw new Error('No valid URLs remaining after validation');
  }

  // Build and return merged XML
  return buildSitemapXml(valid);
}

/**
 * Fetch and parse a sitemap, transforming URLs
 */
async function fetchSitemap(
  sitemapUrl: string,
  source: string,
  transformer: SubdomainTransformer
): Promise<SitemapUrl[]> {
  try {
    const response = await fetch(sitemapUrl, {
      redirect: 'follow', // Follow redirects
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} when fetching ${sitemapUrl}`);
    }

    const xmlContent = await response.text();
    console.log(`[${source}] Fetched sitemap XML, length: ${xmlContent.length}`);
    const urls = await parseSitemap(xmlContent, sitemapUrl);
    console.log(`[${source}] Parsed ${urls.length} URLs from XML`);

    // Transform URLs based on source
    const transformedUrls: SitemapUrl[] = urls.map((url) => {
      const sourceDomain = transformer.getSourceDomain(url.loc);
      const transformedLoc = transformer.transformUrl(url.loc, sourceDomain);

      return {
        ...url,
        loc: transformedLoc,
      };
    });

    // Filter out any invalid URLs
    const validUrls = transformedUrls.filter((url) => {
      try {
        const urlObj = new URL(url.loc);
        const isValid = urlObj.hostname === WWW_DOMAIN;
        
        // Always keep root URL (already validated as www domain)
        if (isValid && isRootUrl(url.loc, urlObj.pathname)) {
          if (source === 'main') {
            console.log(`[${source}] Keeping root URL: ${url.loc}`);
          }
          return true;
        }
        
        if (!isValid && source === 'main') {
          console.warn(`Filtered out main site URL: ${url.loc} (hostname: ${urlObj.hostname})`);
        }
        return isValid;
      } catch {
        if (source === 'main') {
          console.warn(`Filtered out invalid URL: ${url.loc}`);
        }
        return false;
      }
    });

    console.log(
      `Fetched ${urls.length} URLs from ${source}, ${validUrls.length} after transformation`
    );
    
    if (source === 'main' && validUrls.length < urls.length) {
      console.warn(`Main sitemap: ${urls.length - validUrls.length} URLs were filtered out`);
    }

    return validUrls;
  } catch (error) {
    console.error(`Error fetching sitemap from ${sitemapUrl}:`, error);
    throw error;
  }
}

/**
 * Handle test merge request - generates sitemap with detailed breakdown
 */
async function handleTestMergeRequest(env: Env): Promise<Response> {
  try {
    const transformer = new SubdomainTransformer(env.PATH_MAPPINGS);

    // Fetch all three sitemaps in parallel
    const [mainResult, cityResult, careersResult] = await Promise.allSettled([
      fetchSitemap(env.MAIN_SITEMAP_URL, 'main', transformer),
      fetchSitemap(env.CITY_SITEMAP_URL, 'city', transformer),
      fetchSitemap(env.CAREERS_SITEMAP_URL, 'careers', transformer),
    ]);

    // Collect all URLs (with graceful degradation)
    const allUrls: SitemapUrl[] = [];
    const stats = {
      main: { total: 0, error: null as string | null },
      city: { total: 0, error: null as string | null },
      careers: { total: 0, error: null as string | null },
    };

    if (mainResult.status === 'fulfilled') {
      const mainUrls = mainResult.value;
      allUrls.push(...mainUrls);
      stats.main.total = mainUrls.length;
      console.log(`✓ Main sitemap: ${mainUrls.length} URLs`);
    } else {
      stats.main.error = mainResult.reason instanceof Error ? mainResult.reason.message : String(mainResult.reason);
      console.error('✗ Failed to fetch main sitemap:', stats.main.error);
    }

    if (cityResult.status === 'fulfilled') {
      allUrls.push(...cityResult.value);
      stats.city.total = cityResult.value.length;
      console.log(`✓ City sitemap: ${cityResult.value.length} URLs`);
    } else {
      stats.city.error = cityResult.reason instanceof Error ? cityResult.reason.message : String(cityResult.reason);
      console.error('✗ Failed to fetch city sitemap:', stats.city.error);
    }

    if (careersResult.status === 'fulfilled') {
      allUrls.push(...careersResult.value);
      stats.careers.total = careersResult.value.length;
      console.log(`✓ Careers sitemap: ${careersResult.value.length} URLs`);
    } else {
      stats.careers.error = careersResult.reason instanceof Error ? careersResult.reason.message : String(careersResult.reason);
      console.error('✗ Failed to fetch careers sitemap:', stats.careers.error);
    }

    if (allUrls.length === 0) {
      const errors = [
        mainResult.status === 'rejected' ? `Main: ${mainResult.reason}` : null,
        cityResult.status === 'rejected' ? `City: ${cityResult.reason}` : null,
        careersResult.status === 'rejected' ? `Careers: ${careersResult.reason}` : null,
      ].filter(Boolean).join('; ');
      throw new Error(`All sitemap sources failed: ${errors}`);
    }

    // Remove duplicates with tracking
    const dedupResult = removeDuplicateMainSiteUrls(allUrls, true) as DeduplicationResult;
    const deduplicatedUrls = dedupResult.urls;
    const removedUrls = dedupResult.removedUrls;

    // Final SEO validation: ensure all URLs are www domain only
    const { valid, invalid } = validateUrlsAreWwwOnly(deduplicatedUrls);

    if (invalid.length > 0) {
      console.warn(
        `Filtered out ${invalid.length} invalid URLs during final validation`
      );
    }

    // Ensure protected paths exist
    const requiredProtectedPaths = PROTECTED_PATHS.map(path => ({
      path,
      url: `${BASE_URL}${path}`,
    }));

    for (const { path, url } of requiredProtectedPaths) {
      const exists = valid.some(u => {
        try {
          const urlObj = new URL(u.loc);
          return urlObj.pathname === path && urlObj.hostname === WWW_DOMAIN && !u.loc.includes('/city-by-urban');
        } catch {
          return u.loc === url;
        }
      });

      if (!exists) {
        console.log(`Adding missing protected path: ${path}`);
        valid.unshift({ loc: url });
      }
    }

    // Ensure city versions exist
    const cityProtectedPaths = requiredProtectedPaths.filter(p => p.path !== '/city-by-urban');
    for (const { path } of cityProtectedPaths) {
      const cityUrl = `${BASE_URL}/city-by-urban${path}`;
      const exists = valid.some(u => u.loc === cityUrl);

      if (!exists) {
        console.log(`Adding missing city protected path: ${path}`);
        const mainIndex = valid.findIndex(u => {
          try {
            const urlObj = new URL(u.loc);
            return urlObj.pathname === path && urlObj.hostname === WWW_DOMAIN && !u.loc.includes('/city-by-urban');
          } catch {
            return false;
          }
        });
        if (mainIndex >= 0) {
          valid.splice(mainIndex + 1, 0, { loc: cityUrl });
        } else {
          valid.push({ loc: cityUrl });
        }
      }
    }

    if (valid.length === 0) {
      throw new Error('No valid URLs remaining after validation');
    }

    // Build merged XML
    const mergedXml = buildSitemapXml(valid);

    // Create breakdown
    const breakdown = {
      timestamp: new Date().toISOString(),
      statistics: {
        sources: {
          main: {
            total: stats.main.total,
            error: stats.main.error,
          },
          city: {
            total: stats.city.total,
            error: stats.city.error,
          },
          careers: {
            total: stats.careers.total,
            error: stats.careers.error,
          },
        },
        beforeDeduplication: allUrls.length,
        afterDeduplication: deduplicatedUrls.length,
        removedCount: removedUrls.length,
        finalCount: valid.length,
        invalidFiltered: invalid.length,
      },
      removedUrls: removedUrls,
    };

    // Return as JSON with XML as a field
    return new Response(
      JSON.stringify(
        {
          xml: mergedXml,
          breakdown: breakdown,
        },
        null,
        2
      ),
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    console.error('Error in test merge request:', errorMessage, errorStack);
    return new Response(
      JSON.stringify({
        error: 'Unable to generate sitemap',
        message: errorMessage,
        stack: errorStack,
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Handle webhook invalidation requests from Webflow
 */
async function handleWebhookInvalidation(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    // Get request body
    const body = await request.text();
    const signature = request.headers.get('x-webflow-signature');
    const timestamp = request.headers.get('x-webflow-timestamp');

    if (!signature) {
      console.warn('Webhook request missing signature');
      return new Response('Unauthorized', { status: 401 });
    }

    // Parse webhook payload
    let payload: WebflowWebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch (error) {
      console.error('Invalid JSON in webhook payload:', error);
      return new Response('Bad Request', { status: 400 });
    }

    // Verify it's a site_publish event
    if (payload.triggerType !== 'site_publish') {
      console.warn(
        `Unexpected webhook trigger type: ${payload.triggerType}`
      );
      return new Response('Bad Request', { status: 400 });
    }

    // Validate webhook signature
    const secretKey = getWebhookSecret(payload.payload.siteId, env);
    if (!secretKey) {
      console.warn('No webhook secret configured for site');
      // Continue without validation if secret not configured (for development)
      // In production, you'd want to require this
    } else {
      const isValid = await validateWebhookSignature(body, signature, secretKey);
      if (!isValid) {
        console.warn('Invalid webhook signature');
        return new Response('Unauthorized', { status: 401 });
      }
    }

    // Log the publish event
    console.log(
      `Site publish event received: siteId=${payload.payload.siteId}, publishedOn=${payload.payload.publishedOn || payload.payload.publishTime}`
    );

    // Invalidate cache by deleting the cache key
    await env.SITEMAP_CACHE.delete(KV_CACHE_KEY);
    await env.SITEMAP_CACHE.delete(KV_CACHE_TIMESTAMP_KEY);

    console.log('Cache invalidated successfully');

    // Return 200 OK to acknowledge receipt
    return new Response('OK', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  } catch (error) {
    console.error('Error handling webhook:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

