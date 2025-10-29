/**
 * XML sitemap parser for extracting URLs and attributes
 */

import { SitemapUrl } from './types';

/**
 * Parse XML sitemap content and extract URLs
 * Handles both standard sitemaps and sitemap index files
 */
export async function parseSitemap(
  xmlContent: string,
  sourceUrl: string
): Promise<SitemapUrl[]> {
  try {
    // DOMParser is available in Cloudflare Workers runtime
    // For local dev, ensure compatibility_flags includes proper runtime
    let parser: any;
    try {
      parser = new (globalThis as any).DOMParser();
      if (!parser) {
        throw new Error('DOMParser not available');
      }
    } catch (e) {
      // Fallback: DOMParser might not be available in some environments
      // Use regex parsing as fallback
      console.warn('DOMParser not available, using regex parser fallback');
      return parseSitemapWithRegex(xmlContent, sourceUrl);
    }
    const doc = parser.parseFromString(xmlContent, 'text/xml');

    // Check for parsing errors
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      throw new Error(`XML parsing error: ${parserError.textContent}`);
    }

    // Check if this is a sitemap index file
    const sitemapindex = doc.querySelector('sitemapindex');
    if (sitemapindex) {
      // This is a sitemap index, extract referenced sitemap URLs
      const sitemapElements = sitemapindex.querySelectorAll('sitemap');
      const sitemapUrls: string[] = [];

      sitemapElements.forEach((sitemap: any) => {
        const loc = sitemap.querySelector('loc');
        if (loc?.textContent) {
          sitemapUrls.push(loc.textContent.trim());
        }
      });

      // Recursively fetch and parse each referenced sitemap
      const allUrls: SitemapUrl[] = [];
      for (const sitemapUrl of sitemapUrls) {
        try {
          const response = await fetch(sitemapUrl);
          if (!response.ok) {
            console.warn(`Failed to fetch sitemap ${sitemapUrl}: ${response.status}`);
            continue;
          }
          const content = await response.text();
          const urls = await parseSitemap(content, sitemapUrl);
          allUrls.push(...urls);
        } catch (error) {
          console.error(`Error fetching sitemap ${sitemapUrl}:`, error);
        }
      }
      return allUrls;
    }

    // Standard sitemap - extract URLs
    const urlset = doc.querySelector('urlset');
    if (!urlset) {
      throw new Error('No urlset element found in XML');
    }

    const urlElements = urlset.querySelectorAll('url');
    const urls: SitemapUrl[] = [];

    urlElements.forEach((urlElement: any) => {
      const locElement = urlElement.querySelector('loc');
      if (!locElement?.textContent) {
        return; // Skip URLs without location
      }

      const url: SitemapUrl = {
        loc: locElement.textContent.trim(),
      };

      // Extract optional attributes
      const lastmod = urlElement.querySelector('lastmod');
      if (lastmod?.textContent) {
        url.lastmod = lastmod.textContent.trim();
      }

      const changefreq = urlElement.querySelector('changefreq');
      if (changefreq?.textContent) {
        url.changefreq = changefreq.textContent.trim();
      }

      const priority = urlElement.querySelector('priority');
      if (priority?.textContent) {
        url.priority = priority.textContent.trim();
      }

      urls.push(url);
    });

    return urls;
  } catch (error) {
    console.error(`Error parsing sitemap from ${sourceUrl}:`, error);
    throw error;
  }
}

/**
 * Fallback regex-based XML parser for environments without DOMParser
 */
function parseSitemapWithRegex(
  xmlContent: string,
  sourceUrl: string
): SitemapUrl[] {
  const urls: SitemapUrl[] = [];

  // Check if this is a sitemap index
  if (xmlContent.includes('<sitemapindex>')) {
    // Extract sitemap URLs from index
    const sitemapRegex = /<sitemap>[\s\S]*?<loc>(.*?)<\/loc>[\s\S]*?<\/sitemap>/gi;
    const matches = [...xmlContent.matchAll(sitemapRegex)];
    
    const sitemapUrls = matches.map(m => m[1]?.trim()).filter(Boolean);
    
    // Recursively fetch and parse each referenced sitemap
    // Note: This would need to be async, but for now we'll skip index handling in regex mode
    console.warn('Sitemap index detected but regex parser cannot fetch nested sitemaps');
    return [];
  }

  // Parse standard sitemap
  const urlRegex = /<url>([\s\S]*?)<\/url>/gi;
  const urlMatches = [...xmlContent.matchAll(urlRegex)];
  
  console.log(`[regex parser] Found ${urlMatches.length} URL matches in XML`);

  for (const match of urlMatches) {
    const urlBlock = match[1];
    const locMatch = urlBlock.match(/<loc>(.*?)<\/loc>/);
    
    if (!locMatch || !locMatch[1]) {
      console.warn(`[regex parser] Skipping URL block without valid loc: ${urlBlock.substring(0, 100)}`);
      continue;
    }

    const url: SitemapUrl = {
      loc: locMatch[1].trim(),
    };

    // Extract optional attributes
    const lastmodMatch = urlBlock.match(/<lastmod>(.*?)<\/lastmod>/);
    if (lastmodMatch) {
      url.lastmod = lastmodMatch[1].trim();
    }

    const changefreqMatch = urlBlock.match(/<changefreq>(.*?)<\/changefreq>/);
    if (changefreqMatch) {
      url.changefreq = changefreqMatch[1].trim();
    }

    const priorityMatch = urlBlock.match(/<priority>(.*?)<\/priority>/);
    if (priorityMatch) {
      url.priority = priorityMatch[1].trim();
    }

    urls.push(url);
  }

  return urls;
}

