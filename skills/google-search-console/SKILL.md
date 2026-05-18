---
name: google-search-console
description: Pull real Google Search Console data (queries, impressions, clicks, CTR, average position, indexing status) for the configured site via `bun run dispatch google-search-console`. Use this instead of guessing what users search for, whenever you need SEO or search-traffic evidence.
disable-model-invocation: true
---

# Google Search Console (Kevin's analytics plugin)

Real search traffic data for the configured site. The `GSC_SITE_URL` env var names the Search Console property; the authenticated OAuth2 client lives under `app/.config/` and is **shared with other google-* plugins** (currently `google-page-speed`) — one consent flow covers all.

## Commands

Invoke as `bun run dispatch google-search-console <cmd> [args...]`. Output is always JSON on stdout — pipe through `jq` for filtering.

**The command surface is a closed set: `query`, `inspect`, `sites`, `auth`.** There is no `overview`, `summary`, `totals`, `compare`, or `wow` command — do not invent one. Rollups and period-over-period deltas are computed from `query` output with `jq` (see "Totals & WoW" under Common patterns).

### `query <start> <end> [--dim=query,page] [--page=<url>]`

Search-analytics query. Dates in `YYYY-MM-DD`. Default dimension is `query` (top search terms). Returns rows sorted by clicks.

`--dim=` picks the row shape; `--page=<url>` scopes the query to a single page (applies a `dimension=page, operator=equals` filter). The two are independent — you can run `--dim=query --page=<url>` to list the top queries for that one URL.

Flags accept both `--flag=value` and `--flag value` forms.

```bash
# Top 1000 queries last 7 days
mcp__plugin_agent-kevin_kevin__gsc_query 2026-04-13 2026-04-19

# Top URLs (not queries) last 30 days
mcp__plugin_agent-kevin_kevin__gsc_query 2026-03-20 2026-04-19 --dim=page

# Query × page pairs
mcp__plugin_agent-kevin_kevin__gsc_query 2026-04-13 2026-04-19 --dim=query,page

# Top queries for a single page (great for SERP diagnosis on a declining URL)
mcp__plugin_agent-kevin_kevin__gsc_query 2026-04-13 2026-04-19 --page=https://example.com/topic-keyword-a/

# Top 10 queries by clicks
mcp__plugin_agent-kevin_kevin__gsc_query 2026-04-13 2026-04-19 | jq '.[:10] | .[] | {keys:.keys[0], clicks, impressions, ctr, position}'
```

Row shape:
```json
{ "keys": ["<query string>"], "clicks": 12, "impressions": 340, "ctr": 0.035, "position": 8.2 }
```

### `inspect <url>`

URL inspection — indexing status, last crawl time, mobile usability, rich-results. Use to diagnose why a specific page isn't ranking or getting traffic.

```bash
mcp__plugin_agent-kevin_kevin__gsc_inspect https://example.com/topic-keyword-e
```

### `sites`

List verified properties accessible with the current credentials. Useful when `query` fails with a permission error — confirm the `GSC_SITE_URL` string matches exactly (including `sc-domain:` prefix for domain properties vs. full URL for URL-prefix properties).

```bash
mcp__plugin_agent-kevin_kevin__gsc_sites | jq '.[] | .siteUrl'
```

## Common patterns

**Totals & week-over-week** (site-wide rollup for the current period vs prior period):
```bash
# Totals for a single window — sum across all pages
mcp__plugin_agent-kevin_kevin__gsc_query 2026-03-23 2026-04-19 --dim=page \
  | jq '{clicks: (map(.clicks) | add),
         impressions: (map(.impressions) | add),
         ctr: ((map(.clicks) | add) / (map(.impressions) | add)),
         avg_position: ((map(.position * .impressions) | add) / (map(.impressions) | add))}'

# WoW deltas — run the same jq against two adjacent windows, diff the results
mcp__plugin_agent-kevin_kevin__gsc_query 2026-02-23 2026-03-22 --dim=page \
  | jq '{clicks: (map(.clicks) | add), impressions: (map(.impressions) | add)}'
```
Avg position must be impression-weighted (not a flat mean), or pages with few impressions will distort the number.

**Find underperforming pages** (high impressions, low CTR):
```bash
mcp__plugin_agent-kevin_kevin__gsc_query 2026-04-01 2026-04-19 --dim=page \
  | jq 'map(select(.impressions > 100 and .ctr < 0.02)) | sort_by(-.impressions)'
```

**SEO opportunity scan** (pages ranking #11–20 with traffic):
```bash
mcp__plugin_agent-kevin_kevin__gsc_query 2026-03-20 2026-04-19 --dim=query,page \
  | jq 'map(select(.position > 10 and .position < 20 and .impressions > 50)) | sort_by(-.impressions)'
```

**Diagnose a specific page**:
```bash
mcp__plugin_agent-kevin_kevin__gsc_inspect https://example.com/topic-keyword-c
```

## When to use vs not

- ✅ "What queries drove traffic last week?" → `query`
- ✅ "Is this URL indexed?" → `inspect`
- ✅ "Why is this page losing rank?" → `query` with `--dim=page` for traffic trend, then `inspect` for technical issues
- ❌ "What should I write about?" — GSC tells you what you're *already* ranking for. Use Perplexity for broader topic research.
- ❌ Real-time traffic or analytics (sessions, bounce rate) — that's GA4 territory, not Search Console.

## Setup note

If commands fail with "Tokens not minted" — the one-time OAuth dance hasn't been run yet:

```bash
mcp__plugin_agent-kevin_kevin__google_auth
```

This opens a browser, captures Google's consent, and persists the refresh token to `app/.config/google-tokens.json` — **the same token is used by every google-* plugin**, so you only run `auth` once, not once per plugin. You handle this once per install; Kevin should not normally need to run `auth`.
