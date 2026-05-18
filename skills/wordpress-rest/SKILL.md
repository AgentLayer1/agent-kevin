---
name: wordpress-rest
description: Query WordPress content via the public WP REST API — posts, pages, custom post types, categories, tags, media, and modified dates. Use this when auditing a WordPress site's content, cross-referencing with Search Console data, or listing products/brands from Toolset custom post types. Targets whatever site is configured via `GSC_SITE_URL` (same site used by `google-search-console`). No authentication required for published content. For SEO title/meta (The SEO Framework, Yoast, RankMath, AIOSEO), fall back to Playwright — those fields are injected at render time and not in the REST response.
disable-model-invocation: true
---

# WordPress REST API

Plain HTTP, no auth, no plugin. Every WordPress site exposes the REST API at `/wp-json/wp/v2/` for published content. This skill documents the endpoints Kevin actually uses.

> **Not a dispatch plugin.** Call the WP REST API with `curl` directly. There is no `bun run dispatch wordpress-rest` — that command will fail.

## Target site

Set `$WP` to the same URL configured under `GSC_SITE_URL` (so `wordpress-rest` and `google-search-console` share one source of truth for "the site under analysis"). Examples below use `example.com` as the placeholder — substitute with the actual host.

```bash
WP="${GSC_SITE_URL:-https://example.com}"
WP="${WP%/}"   # strip trailing slash if present
```

## Core endpoints

### Posts / pages

```bash
# List the 100 most recent posts, minimal fields
curl -s "$WP/wp-json/wp/v2/posts?per_page=100&_fields=id,slug,title,modified,link,categories"

# Pages (different endpoint than posts)
curl -s "$WP/wp-json/wp/v2/pages?per_page=100&_fields=id,slug,title,modified,link"

# One specific post by slug
curl -s "$WP/wp-json/wp/v2/posts?slug=topic-keyword-b&_fields=id,title,excerpt,modified,link"

# Full post body (rendered HTML)
curl -s "$WP/wp-json/wp/v2/posts/<id>" | jq '{title: .title.rendered, content: .content.rendered[:500], modified}'
```

### Custom post types (Toolset)

Example custom post types from a Toolset-based WordPress site — `custom_product` (Products) and `brand` (Brands). Substitute the slugs your site actually defines:

```bash
# All shop products
curl -s "$WP/wp-json/wp/v2/custom_product?per_page=100&_fields=id,slug,title,link,modified"

# All brand pages
curl -s "$WP/wp-json/wp/v2/brand?per_page=100&_fields=id,slug,title,link"
```

### Taxonomies

```bash
# Categories
curl -s "$WP/wp-json/wp/v2/categories?per_page=100&_fields=id,slug,name,count"

# Posts in a specific category
curl -s "$WP/wp-json/wp/v2/posts?categories=<id>&per_page=100&_fields=id,slug,title,modified"

# NN's Shop Cleaning Categories custom taxonomy
curl -s "$WP/wp-json/wp/v2/shop_cleaning_category?per_page=100&_fields=id,slug,name,count"
```

### Content filters (cross-referencing with GSC data)

```bash
# Posts modified in last 30 days
curl -s "$WP/wp-json/wp/v2/posts?modified_after=2026-03-20T00:00:00&per_page=100&_fields=id,slug,modified"

# Posts NOT modified in 180+ days (stale content)
# WP REST doesn't have modified_before, so fetch all then filter client-side
curl -s "$WP/wp-json/wp/v2/posts?per_page=100&_fields=id,slug,modified" \
  | jq 'map(select(.modified < "2025-10-19")) | sort_by(.modified)'

# Search post body
curl -s "$WP/wp-json/wp/v2/posts?search=washing+soda&per_page=20&_fields=id,slug,title"
```

### Media

```bash
# All media
curl -s "$WP/wp-json/wp/v2/media?per_page=100&_fields=id,source_url,alt_text,title"

# Media attached to a specific post
curl -s "$WP/wp-json/wp/v2/media?parent=<post_id>&_fields=id,source_url,alt_text"
```

### Pagination

WP REST returns headers (not body) for total counts:

```bash
curl -sI "$WP/wp-json/wp/v2/posts?per_page=100" | grep -i 'x-wp-total\|x-wp-totalpages'
# X-WP-Total: 247
# X-WP-TotalPages: 3

# Page 2
curl -s "$WP/wp-json/wp/v2/posts?per_page=100&page=2"
```

## ⚠️ The SEO Framework caveat

Core WP REST does NOT expose The SEO Framework's title/meta overrides. The `title.rendered` field is the post's H1/page title, NOT the SEO title that appears in SERPs.

**Always scrape the rendered page for SEO meta truth**:

```bash
# Via the playwright plugin
path=$(mcp__plugin_agent-kevin_kevin__playwright_screenshot "https://example.com/topic-keyword-b/" /tmp/fc.png)

# Or curl for quick tag extraction (static HTML only — WP renders this fine)
curl -s https://example.com/topic-keyword-b/ \
  | grep -oE '<title>[^<]+</title>|<meta name="description" content="[^"]+"|<meta property="og:[^"]+" content="[^"]+"'
```

The rendered page is what Google sees. That's the source of truth for titles, meta descriptions, OG tags, and JSON-LD.

## Common audit recipes

**Count of published posts vs pages vs products**:
```bash
for type in posts pages custom_product brand; do
  total=$(curl -sI "$WP/wp-json/wp/v2/$type?per_page=1" | grep -i 'x-wp-total:' | awk '{print $2}' | tr -d '\r')
  echo "$type: $total"
done
```

**All post slugs (for matching against GSC page URLs)**:
```bash
curl -s "$WP/wp-json/wp/v2/posts?per_page=100&_fields=slug" | jq -r '.[] | .slug'
```

**Find posts with no featured image** (Toolset + Astra theme use this):
```bash
curl -s "$WP/wp-json/wp/v2/posts?per_page=100&_fields=id,slug,featured_media" \
  | jq 'map(select(.featured_media == 0)) | .[] | {id, slug}'
```

**Kitchen-room products (for nn-014 progress tracking)**:
```bash
# First find the Kitchen taxonomy term ID, then filter products
kitchen_id=$(curl -s "$WP/wp-json/wp/v2/shop_cleaning_category?slug=kitchen&_fields=id" | jq -r '.[0].id')
curl -s "$WP/wp-json/wp/v2/custom_product?shop_cleaning_category=$kitchen_id&per_page=100&_fields=id,slug,title"
```

## Fallback: if the REST API is unavailable

**Fall back to Playwright scrape only** — lose the structured content queries but keep the rendered-page audit.

## When to use vs not

- ✅ Listing content at scale ("all posts in Kitchen category modified in 2026")
- ✅ Cross-referencing GSC page URLs with WP slugs to find off-site pages
- ✅ Shop progress tracking (product counts, brand pages live)
- ✅ Content freshness audits (`modified` dates)
- ❌ Reading SEO title/meta — use Playwright scrape instead
- ❌ Writing anything — Kevin is strictly read-only on NN
- ❌ User/author data — requires auth; not needed for current workflows
