/**
 * XML sitemap builder - merges, sorts, and generates sitemap XML
 */

import { SitemapUrl } from './types';

const MAX_URLS_PER_SITEMAP = 50000;
const SITEMAP_NAMESPACE = 'http://www.sitemaps.org/schemas/sitemap/0.9';

/**
 * Build unified sitemap XML from merged URLs
 */
export function buildSitemapXml(urls: SitemapUrl[]): string {
  // Remove duplicates by URL
  const uniqueUrls = removeDuplicates(urls);

  // Sort URLs alphabetically by location
  const sortedUrls = uniqueUrls.sort((a, b) => a.loc.localeCompare(b.loc));

  // If URLs exceed limit, return sitemap index
  if (sortedUrls.length > MAX_URLS_PER_SITEMAP) {
    return buildSitemapIndex(sortedUrls);
  }

  // Build standard sitemap
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<urlset xmlns="${SITEMAP_NAMESPACE}">\n`;

  for (const url of sortedUrls) {
    xml += '  <url>\n';
    xml += `    <loc>${escapeXml(url.loc)}</loc>\n`;

    if (url.lastmod) {
      xml += `    <lastmod>${escapeXml(url.lastmod)}</lastmod>\n`;
    }

    if (url.changefreq) {
      xml += `    <changefreq>${escapeXml(url.changefreq)}</changefreq>\n`;
    }

    if (url.priority) {
      xml += `    <priority>${escapeXml(url.priority)}</priority>\n`;
    }

    xml += '  </url>\n';
  }

  xml += '</urlset>';
  return xml;
}

/**
 * Build sitemap index when URLs exceed limit
 */
function buildSitemapIndex(urls: SitemapUrl[]): string {
  const chunks: SitemapUrl[][] = [];
  
  // Split into chunks of MAX_URLS_PER_SITEMAP
  for (let i = 0; i < urls.length; i += MAX_URLS_PER_SITEMAP) {
    chunks.push(urls.slice(i, i + MAX_URLS_PER_SITEMAP));
  }

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<sitemapindex xmlns="${SITEMAP_NAMESPACE}">\n`;

  for (let i = 0; i < chunks.length; i++) {
    const sitemapUrl = `https://www.urbanpubsandbars.com/sitemap-${i + 1}.xml`;
    xml += '  <sitemap>\n';
    xml += `    <loc>${escapeXml(sitemapUrl)}</loc>\n`;
    xml += '  </sitemap>\n';
  }

  xml += '</sitemapindex>';
  return xml;
}

/**
 * Build individual sitemap for pagination (used when > 50k URLs)
 */
export function buildSitemapXmlForPage(urls: SitemapUrl[], page: number): string {
  // This would be used if we implement pagination
  // For now, we'll just build standard sitemap
  return buildSitemapXml(urls);
}

/**
 * Normalize URL by removing trailing slash (except for root)
 */
function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    // Keep root URL as-is (with or without slash)
    if (urlObj.pathname === '/' || urlObj.pathname === '') {
      return url;
    }
    // Remove trailing slash for all other paths
    if (urlObj.pathname.endsWith('/')) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
      return urlObj.toString();
    }
    return url;
  } catch {
    // If URL parsing fails, return as-is
    return url;
  }
}

/**
 * Remove duplicate URLs (keep first occurrence)
 * Handles URLs with/without trailing slashes as duplicates
 */
function removeDuplicates(urls: SitemapUrl[]): SitemapUrl[] {
  const seen = new Set<string>();
  const unique: SitemapUrl[] = [];

  for (const url of urls) {
    const normalized = normalizeUrl(url.loc);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      unique.push(url);
    }
  }

  return unique;
}

/**
 * Escape XML special characters
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Final validation: ensure all URLs are www domain only
 */
export function validateUrlsAreWwwOnly(urls: SitemapUrl[]): {
  valid: SitemapUrl[];
  invalid: SitemapUrl[];
} {
  const valid: SitemapUrl[] = [];
  const invalid: SitemapUrl[] = [];
  const wwwDomain = 'www.urbanpubsandbars.com';
  const subdomainDomains = [
    'city.urbanpubsandbars.com',
    'careers.urbanpubsandbars.com',
  ];

  for (const url of urls) {
    try {
      const urlObj = new URL(url.loc);

      // Must be www domain
      if (urlObj.hostname !== wwwDomain) {
        console.warn(
          `Invalid URL (not www domain): ${url.loc} (hostname: ${urlObj.hostname})`
        );
        invalid.push(url);
        continue;
      }

      // Always keep root URL
      if (urlObj.pathname === '/' || urlObj.pathname === '' || 
          url.loc === 'https://www.urbanpubsandbars.com' || 
          url.loc === 'https://www.urbanpubsandbars.com/') {
        valid.push(url);
        continue;
      }

      // Must not contain subdomain domains in URL string
      if (
        subdomainDomains.some((subdomain) => url.loc.includes(subdomain))
      ) {
        console.warn(`Invalid URL (contains subdomain): ${url.loc}`);
        invalid.push(url);
        continue;
      }

      valid.push(url);
    } catch (error) {
      console.error(`Error validating URL ${url.loc}:`, error);
      invalid.push(url);
    }
  }

  if (invalid.length > 0) {
    console.error(
      `Found ${invalid.length} invalid URLs that will be filtered out`
    );
  }

  return { valid, invalid };
}

