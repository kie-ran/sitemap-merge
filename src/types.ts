/**
 * Type definitions for the sitemap merger worker
 */

export interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
}

export interface SubdomainMapping {
  pathPrefix: string;
  subdomain: string;
}

export interface SourceSitemap {
  urls: SitemapUrl[];
  source: string; // which site it came from (main, city, careers)
  fetchedAt: number;
}

export interface Env {
  // Environment variables
  MAIN_SITEMAP_URL: string;
  CITY_SITEMAP_URL: string;
  CAREERS_SITEMAP_URL: string;
  PATH_MAPPINGS: string;
  
  // Optional webhook secrets (for webhook validation)
  WEBHOOK_SECRET_MAIN?: string;
  WEBHOOK_SECRET_CITY?: string;
  WEBHOOK_SECRET_CAREERS?: string;
  
  // KV namespace binding
  SITEMAP_CACHE: KVNamespace;
}

export interface WebflowWebhookPayload {
  triggerType: string;
  payload: {
    siteId: string;
    publishedOn?: string;
    publishTime?: number;
    domains?: string[];
    publishedBy?: {
      displayName?: string;
      name?: string;
      id?: string;
      email?: string;
    };
  };
}

