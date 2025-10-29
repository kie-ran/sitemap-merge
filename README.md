# Sitemap Merger Worker

Cloudflare Worker that merges sitemaps from three Webflow sites (www, city, careers) into a single unified sitemap served at `www.urbanpubsandbars.com/sitemap.xml`.

## Features

- ✅ Merges sitemaps from three sources (www, city, careers subdomains)
- ✅ Transforms subdomain URLs to www domain with correct path prefixes
- ✅ SEO-safe: Ensures only www URLs appear in merged sitemap
- ✅ Intelligent deduplication: Removes main site URLs where city versions exist
- ✅ Protected paths: Preserves critical paths in both main and city versions
- ✅ KV caching for performance (24-hour TTL or webhook invalidation)
- ✅ Webhook-based cache invalidation on site publish
- ✅ Graceful degradation if one source fails
- ✅ Handles sitemap index files
- ✅ Removes duplicates and normalizes URLs (trailing slash handling)
- ✅ Sorts URLs alphabetically

## Project Structure

```
sitemap-merge/
├── src/
│   ├── index.ts              # Main Worker handler
│   ├── sitemap-parser.ts     # XML parsing and URL extraction
│   ├── url-transformer.ts    # URL transformation logic
│   ├── sitemap-builder.ts    # XML sitemap generation
│   ├── webhook-validator.ts # Webhook signature validation
│   ├── types.ts              # TypeScript definitions
│   └── workers.d.ts           # Cloudflare Workers type definitions
├── wrangler.toml            # Worker configuration (routes, vars, KV)
├── package.json             # Dependencies and scripts
├── tsconfig.json           # TypeScript configuration
└── README.md               # This file
```

## URL Transformation Rules

1. **Main Site (www.urbanpubsandbars.com)**: URLs remain unchanged
2. **City Subdomain**: `city.urbanpubsandbars.com/path` → `www.urbanpubsandbars.com/city-by-urban/path`
3. **Careers Subdomain**: `careers.urbanpubsandbars.com/path` → `www.urbanpubsandbars.com/work-with-us/path`

## Deduplication Logic

The worker intelligently removes duplicate URLs:

- **Removes**: Main site URLs that have a corresponding city-transformed version
- **Keeps**: Protected paths in both main and city versions:
  - `/` (root)
  - `/city-by-urban`
  - `/venues`
  - `/private-hire`
  - `/whats-on`
  - `/christmas`
  - `/bookings`
  - `/contact`
- **Keeps**: URLs matching protected patterns (e.g., `/bookings/all-sites*`)
- **Normalizes**: URLs with/without trailing slashes are treated as duplicates

## Setup

### Prerequisites

- Node.js 18+
- Wrangler CLI
- Cloudflare account with Workers access

### Installation

```bash
npm install
```

### Configuration

The `wrangler.toml` file is already configured with:
- Production routes
- Environment variables (sitemap URLs, path mappings)
- KV namespace binding

**KV Namespace**: Already configured. If you need to recreate:
```bash
wrangler kv:namespace create "SITEMAP_CACHE"
wrangler kv:namespace create "SITEMAP_CACHE" --preview
```

Update the `id` and `preview_id` in `wrangler.toml` with the output.

### Development

```bash
npm run dev
```

Test locally:
```bash
curl http://localhost:8787/sitemap.xml
```

### Deployment

```bash
npm run deploy
```

## Webhook Setup for Cache Invalidation

The worker automatically invalidates the sitemap cache when any of the three Webflow sites are published.

### Site IDs

- **Main Site (www)**: `64cd0b3dbdde72b77a84b64a`
- **City Site**: `68d522effac830efd4fe0eab`
- **Careers Site**: `67a32793460513bd1a327ed2`

### Create Webhooks

For each site, create a webhook in Webflow:

- **Trigger Type**: `site_publish`
- **Webhook URL**: `https://www.urbanpubsandbars.com/webhook/sitemap-invalidate`
- **Method**: POST

You can create webhooks via the Webflow Dashboard or API:

```bash
curl -X POST "https://api.webflow.com/v2/sites/{SITE_ID}/webhooks" \
  -H "Authorization: Bearer YOUR_WEBFLOW_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "triggerType": "site_publish",
    "url": "https://www.urbanpubsandbars.com/webhook/sitemap-invalidate"
  }'
```

Replace `{SITE_ID}` with the appropriate site ID above.

### Configure Webhook Secrets

After creating webhooks, save the `secretKey` from each webhook response and set them in Wrangler:

```bash
wrangler secret put WEBHOOK_SECRET_MAIN
wrangler secret put WEBHOOK_SECRET_CITY
wrangler secret put WEBHOOK_SECRET_CAREERS
```

Paste the `secretKey` when prompted for each one.

## How It Works

### Request Flow

When `/sitemap.xml` is requested:

1. Check KV cache first
2. If cached and fresh (< 24 hours), return cached sitemap
3. Otherwise, fetch all three source sitemaps in parallel:
   - `https://www.urbanpubsandbars.com/sitemap.xml`
   - `https://city.urbanpubsandbars.com/sitemap.xml`
   - `https://careers.urbanpubsandbars.com/sitemap.xml`
4. Transform URLs from city/careers subdomains to www domain
5. Merge all URLs
6. Remove duplicates (main site URLs with city versions)
7. Preserve protected paths
8. Validate all URLs are www domain only (SEO safety)
9. Normalize URLs (remove trailing slashes)
10. Store in KV cache and return

### Webhook Flow

When a site is published:

1. Webflow sends POST to `/webhook/sitemap-invalidate`
2. Worker validates webhook signature (HMAC-SHA256)
3. Cache is invalidated (deleted from KV)
4. Next sitemap request will fetch fresh data and regenerate

## SEO Safety

The worker includes multiple validation checkpoints:

1. **Post-transformation validation**: Each URL is validated after transformation
2. **Pre-merge filtering**: Invalid URLs are filtered before merging
3. **Final validation**: Complete validation pass before generating XML
4. **URL normalization**: Trailing slashes handled consistently

All validation ensures:
- ✅ All URLs use `www.urbanpubsandbars.com` domain
- ❌ No subdomain URLs (`city.urbanpubsandbars.com`, `careers.urbanpubsandbars.com`)
- ❌ No external domains in the merged sitemap
- ✅ Duplicate URLs removed (including trailing slash variants)

## Error Handling

- **Graceful degradation**: If one source sitemap fails, others are still processed
- **All sources fail**: Returns 503 error
- **Invalid URLs**: Logged and filtered out
- **Cache failures**: Fall back to fresh generation
- **Webhook errors**: Logged but don't block sitemap generation

## Performance

- **Caching**: 24-hour TTL or webhook invalidation
- **Parallel fetching**: All three sitemaps fetched simultaneously
- **Edge caching**: Cloudflare edge cache via `Cache-Control` headers
- **Current size**: ~1,868 URLs (well within 50,000 limit)

## Limitations

- Maximum 50,000 URLs per sitemap (if exceeded, pagination would need to be implemented)
- Cache TTL: 24 hours (or until webhook invalidation)
- Webhook validation is optional if secrets aren't configured (for development)
- URL normalization: Trailing slashes removed except for root URL

## Testing

1. **Local development**: 
   ```bash
   npm run dev
   curl http://localhost:8787/sitemap.xml
   ```

2. **Production verification**:
   ```bash
   curl https://www.urbanpubsandbars.com/sitemap.xml
   ```

3. **Verify URL transformations**: Check that all URLs use `www.urbanpubsandbars.com`

4. **Test webhook**: Publish a page in Webflow and monitor logs:
   ```bash
   wrangler tail
   ```

## Security Considerations

- ✅ Webhook signature validation (HMAC-SHA256)
- ✅ Input validation on all URLs
- ✅ XML escaping to prevent injection
- ✅ Domain whitelist validation
- ✅ Secrets stored in Wrangler (encrypted)

## Worker Configuration

The worker is deployed at:
- **Worker Name**: `sitemap-merge`
- **Routes**:
  - `www.urbanpubsandbars.com/sitemap.xml`
  - `www.urbanpubsandbars.com/webhook/sitemap-invalidate`

## Architecture

```
User Request → /sitemap.xml
    ↓
Cloudflare Worker (sitemap-merge)
    ↓
Check KV Cache
    ↓ (cache miss)
Fetch 3 Sitemaps (parallel)
    ↓
Transform URLs
    ↓
Merge & Deduplicate
    ↓
Validate & Normalize
    ↓
Cache & Return
```

**Webhook Trigger:**
```
Site Published → Webhook POST
    ↓
Validate Signature
    ↓
Invalidate Cache
    ↓
Next Request → Fresh Generation
```

## License

MIT
