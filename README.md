# Sitemap Merge Worker

Cloudflare Worker that merges sitemaps from three Webflow sites (main, city, careers) into a single, unified, SEO-safe sitemap.

## Features

- ✅ Merges three sitemap sources into one
- ✅ URL transformation (subdomain → main domain with path prefixes)
- ✅ Intelligent deduplication with protected paths
- ✅ KV caching for performance (24-hour TTL)
- ✅ Webhook-based cache invalidation on site publish
- ✅ SEO validation (www domain only)
- ✅ URL normalization (trailing slash handling)

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

## Viewing Logs

### Option 1: Cloudflare Dashboard
1. Go to **Workers & Pages** in your Cloudflare dashboard
2. Click on **sitemap-merge**
3. Click on the **Logs** tab
4. You can filter/search for specific requests

### Option 2: Wrangler Tail (Real-time)
```bash
# Tail all logs
wrangler tail sitemap-merge

# Tail with search filter
wrangler tail sitemap-merge --search "sitemap"

# Tail with status filter
wrangler tail sitemap-merge --status ok --status error

# Tail with format option
wrangler tail sitemap-merge --format pretty
```

**Note**: Worker logs are separate from Cloudflare Analytics logs. They're only visible in the Workers dashboard or via `wrangler tail`.

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
  -H "Authorization: Bearer YOUR_API_TOKEN" \
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

1. Log incoming request
2. Check KV cache first
3. If cached and fresh (< 24 hours), return cached sitemap
4. Otherwise, fetch all three source sitemaps in parallel:
   - `https://www.urbanpubsandbars.com/sitemap.xml`
   - `https://city.urbanpubsandbars.com/sitemap.xml`
   - `https://careers.urbanpubsandbars.com/sitemap.xml`
5. Transform URLs from city/careers subdomains to www domain
6. Merge all URLs
7. Remove duplicates (main site URLs with city versions)
8. Preserve protected paths
9. Validate all URLs are www domain only (SEO safety)
10. Normalize URLs (remove trailing slashes)
11. Store in KV cache and return

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
- ✅ No duplicate URLs (main vs city versions)
- ✅ Protected paths preserved in both forms
- ✅ Consistent URL format (no trailing slashes except root)

## Clearing Cache

To manually clear the sitemap cache:

```bash
# Delete the cache key
wrangler kv key delete "merged_sitemap" --binding="SITEMAP_CACHE" --remote --preview=false

# Delete the timestamp key
wrangler kv key delete "merged_sitemap_timestamp" --binding="SITEMAP_CACHE" --remote --preview=false
```

## Project Structure

```
sitemap-merge/
├── src/
│   ├── index.ts              # Main worker handler
│   ├── sitemap-parser.ts      # XML parsing logic
│   ├── sitemap-builder.ts     # XML generation logic
│   ├── url-transformer.ts     # URL transformation logic
│   ├── webhook-validator.ts   # Webhook signature validation
│   └── types.ts               # TypeScript type definitions
├── wrangler.toml              # Worker configuration
├── package.json               # Dependencies
└── README.md                   # This file
```

## License

MIT
