/**
 * URL transformation logic for converting subdomain URLs to www domain with path prefixes
 */

import { SubdomainMapping } from './types';

/**
 * Transforms URLs from subdomains to www domain with appropriate path prefixes
 */
export class SubdomainTransformer {
  private mappings: SubdomainMapping[];
  private readonly WWW_DOMAIN = 'www.urbanpubsandbars.com';
  private readonly MAIN_DOMAIN = 'urbanpubsandbars.com'; // Main site without www
  private readonly CITY_SUBDOMAIN = 'city.urbanpubsandbars.com';
  private readonly CAREERS_SUBDOMAIN = 'careers.urbanpubsandbars.com';

  constructor(pathMappings: string) {
    this.mappings = this.parseMappings(pathMappings);
  }

  /**
   * Parse path mappings from env var format: "path-prefix:subdomain, path-prefix2:subdomain2"
   */
  private parseMappings(pathMappings: string): SubdomainMapping[] {
    const mappings: SubdomainMapping[] = [];

    // Split by comma and process each mapping
    const parts = pathMappings.split(',').map((p) => p.trim());

    for (const part of parts) {
      const [pathPrefix, subdomain] = part.split(':').map((s) => s.trim());
      if (pathPrefix && subdomain) {
        mappings.push({ pathPrefix, subdomain });
      }
    }

    return mappings;
  }

  /**
   * Transform a URL based on its source domain
   */
  transformUrl(url: string, sourceDomain: string): string {
    try {
      const urlObj = new URL(url);

      // Main site URLs (with or without www) - normalize to www
      if (urlObj.hostname === this.WWW_DOMAIN) {
        return url; // Already has www, return as-is
      }
      
      if (urlObj.hostname === this.MAIN_DOMAIN) {
        // Normalize main site URLs without www to include www
        const normalizedUrl = new URL(url);
        normalizedUrl.hostname = this.WWW_DOMAIN;
        return normalizedUrl.toString();
      }
      
      // Fallback: if sourceDomain indicates main but hostname didn't match (shouldn't happen)
      if (sourceDomain === 'main' && urlObj.hostname !== this.WWW_DOMAIN) {
        const normalizedUrl = new URL(url);
        normalizedUrl.hostname = this.WWW_DOMAIN;
        return normalizedUrl.toString();
      }

      // City subdomain transformation
      if (urlObj.hostname === this.CITY_SUBDOMAIN) {
        const transformedUrl = this.transformWithPrefix(
          urlObj,
          this.WWW_DOMAIN,
          'city-by-urban'
        );
        return this.validateTransformation(transformedUrl, url);
      }

      // Careers subdomain transformation
      if (urlObj.hostname === this.CAREERS_SUBDOMAIN) {
        // Special handling for root path
        let pathPrefix = 'work-with-us';
        if (urlObj.pathname === '/' || urlObj.pathname === '') {
          // Root path maps to /work-with-us
          const transformedUrl = new URL(
            `https://${this.WWW_DOMAIN}/${pathPrefix}`
          );
          transformedUrl.search = urlObj.search;
          transformedUrl.hash = urlObj.hash;
          return this.validateTransformation(transformedUrl.toString(), url);
        }

        const transformedUrl = this.transformWithPrefix(
          urlObj,
          this.WWW_DOMAIN,
          pathPrefix
        );
        return this.validateTransformation(transformedUrl, url);
      }

      // If domain doesn't match any of our expected domains, but sourceDomain is main, normalize it
      if (sourceDomain === 'main') {
        const normalizedUrl = new URL(url);
        normalizedUrl.hostname = this.WWW_DOMAIN;
        console.log(`Normalizing main site URL (fallback): ${url} -> ${normalizedUrl.toString()}`);
        return normalizedUrl.toString();
      }

      // If domain doesn't match any of our expected domains, return as-is
      // (but this shouldn't happen in normal operation)
      console.warn(`Unexpected domain in URL: ${urlObj.hostname}, sourceDomain: ${sourceDomain}`);
      return url;
    } catch (error) {
      console.error(`Error transforming URL ${url}:`, error);
      throw error;
    }
  }

  /**
   * Transform URL with a path prefix
   */
  private transformWithPrefix(
    urlObj: URL,
    newHostname: string,
    pathPrefix: string
  ): string {
    const newPath = `/${pathPrefix}${urlObj.pathname}`;
    const transformedUrl = new URL(`https://${newHostname}${newPath}`);
    transformedUrl.search = urlObj.search;
    transformedUrl.hash = urlObj.hash;
    return transformedUrl.toString();
  }

  /**
   * Validate that transformation result is correct (www domain only)
   */
  private validateTransformation(
    transformed: string,
    original: string
  ): string {
    const transformedUrl = new URL(transformed);

    // Critical SEO validation: Must be www domain
    if (transformedUrl.hostname !== this.WWW_DOMAIN) {
      const error = `Transform validation failed: ${original} → ${transformed}. Hostname must be ${this.WWW_DOMAIN}`;
      console.error(error);
      throw new Error(error);
    }

    // Reject subdomain domains
    if (
      transformedUrl.hostname.includes(this.CITY_SUBDOMAIN) ||
      transformedUrl.hostname.includes(this.CAREERS_SUBDOMAIN)
    ) {
      const error = `Subdomain URL detected in transformation result: ${transformed}`;
      console.error(error);
      throw new Error(error);
    }

    return transformed;
  }

  /**
   * Determine source domain from a URL
   */
  getSourceDomain(url: string): 'main' | 'city' | 'careers' | 'unknown' {
    try {
      const urlObj = new URL(url);
      if (urlObj.hostname === this.WWW_DOMAIN || urlObj.hostname === this.MAIN_DOMAIN) {
        return 'main';
      }
      if (urlObj.hostname === this.CITY_SUBDOMAIN) {
        return 'city';
      }
      if (urlObj.hostname === this.CAREERS_SUBDOMAIN) {
        return 'careers';
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Filter URLs that are valid (from our three domains and properly transformed)
   */
  filterValidUrls(urls: string[]): string[] {
    return urls.filter((url) => {
      try {
        const transformed = this.transformUrl(url, this.getSourceDomain(url));
        const transformedUrl = new URL(transformed);

        // Final validation: all URLs must be www domain
        if (transformedUrl.hostname !== this.WWW_DOMAIN) {
          console.warn(`Filtered out invalid URL (not www domain): ${url}`);
          return false;
        }

        // Reject any subdomain references
        if (
          transformed.includes(this.CITY_SUBDOMAIN) ||
          transformed.includes(this.CAREERS_SUBDOMAIN)
        ) {
          console.warn(`Filtered out URL containing subdomain: ${url}`);
          return false;
        }

        return true;
      } catch {
        return false;
      }
    });
  }

  /**
   * Normalize main site URLs (without www) to include www
   */
  normalizeMainSiteUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      if (urlObj.hostname === this.MAIN_DOMAIN) {
        urlObj.hostname = this.WWW_DOMAIN;
        return urlObj.toString();
      }
      return url;
    } catch {
      return url;
    }
  }
}

