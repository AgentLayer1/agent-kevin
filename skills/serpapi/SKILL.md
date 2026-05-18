---
name: serpapi
description: Real Google SERP data (organic results, AI overview, shopping carousel, People Also Ask, knowledge graph, related searches) via SerpAPI. Use this whenever you need ground-truth on what's ranking for a query, what SERP features Google is showing, or how the SERP differs between desktop and mobile. This is the correct tool for SERP investigation — headless playwright will CAPTCHA on Google and should not be used for SERP capture.
disable-model-invocation: true
---

# SerpAPI (Kevin's SERP plugin)

Live SERP ground-truth for SEO diagnosis. Requires `SERPAPI_KEY` (paid plan at https://serpapi.com).

## ⚠️ Cost awareness

Each call consumes one search from the SerpAPI plan. Use it when the question genuinely needs live Google SERP data — ranking diagnosis, SERP-feature detection, intent analysis, competitor ranking snapshot. Don't use it to answer questions that GSC already answers (what *we* rank for, our own CTR, impressions) or that Perplexity can answer (topic research, summarised web knowledge).

## ⚠️ Don't use playwright for SERPs

Google CAPTCHAs headless browsers on `google.com/search?q=...`. Playwright will reliably fail there. SerpAPI is the correct tool for SERP capture.

## Commands

### `search <query> [flags]`

Runs one SERP query. Flags are positional-flexible — both `--flag=value` and `--flag value` work. Everything that isn't a recognised flag is joined (space-separated) as the query, so quoting is optional.

| Flag | Default | Purpose |
|---|---|---|
| `--engine=<name>` | `google` | Other engines: `google_images`, `google_news`, `google_shopping`, `bing`, etc. |
| `--gl=<country>` | `us` | Country code for geographic targeting |
| `--hl=<lang>` | `en` | UI language |
| `--num=<n>` | 10 | Number of organic results (up to 100) |
| `--device=<d>` | `desktop` | `desktop` \| `mobile` \| `tablet` — mobile SERPs often differ (different carousels, AI overview presence) |
| `--location=<city>` | — | Physical location string (e.g. `"Austin, Texas"`) for localised results |
| `--google-domain=<d>` | `google.com` | TLD variant (`google.com.my` for Malaysia, etc.) |

```bash
# Top 10 organic + SERP features for a query
mcp__plugin_agent-kevin_kevin__serpapi_search non toxic air freshener

# Mobile SERP (different AI overview behaviour than desktop)
mcp__plugin_agent-kevin_kevin__serpapi_search non toxic air freshener --device=mobile

# 20 results, localised to the UK
mcp__plugin_agent-kevin_kevin__serpapi_search reed diffuser --num=20 --gl=gb --hl=en

# People Also Ask mining for a content outline
mcp__plugin_agent-kevin_kevin__serpapi_search washing soda uses --num=5 | jq '.related_questions[] | .question'
```

## Return shape (trimmed)

The plugin trims SerpAPI's raw response to the fields that matter for SEO work (the raw response is 30–50KB and blows Kevin's context without helping analysis):

```json
{
  "query": "non toxic air freshener",
  "engine": "google",
  "gl": "us",
  "hl": "en",
  "device": "desktop",
  "total_results": 12300000,
  "time_taken": 0.47,
  "serp_features": ["ai_overview", "shopping", "people_also_ask", "videos"],
  "ai_overview": { "present": true, "reference_count": 7, "block_count": 4 },
  "answer_box": null,
  "knowledge_graph": null,
  "organic_results": [
    { "position": 1, "title": "...", "link": "https://...", "displayed_link": "...", "snippet": "...", "source": "" }
  ],
  "shopping_results": [ { "position": 1, "title": "...", "link": "...", "source": "Target", "price": "$12.99" } ],
  "related_questions": [ { "question": "...", "snippet": "...", "link": "..." } ],
  "related_searches": ["...", "..."],
  "ad_count": 3
}
```

- `serp_features` — quick-read tag list of what features are showing on the SERP. Use this first to diagnose intent (a SERP with `shopping` + `ads` = commercial intent; one with `answer_box` + `people_also_ask` = informational).
- `ai_overview` — presence check. When `present: true`, clicks on organic results typically drop 30–60%, and the AI overview's sources are your real competitors for visibility.
- `organic_results[].source` — publisher hint (not always populated). Cross-reference with the `link` domain for a truer read.

## Common patterns

**Diagnose why our page's CTR is low** — compare what's ranking above us:
```bash
mcp__plugin_agent-kevin_kevin__serpapi_search non toxic air freshener \
  | jq '{features: .serp_features, ai: .ai_overview, top5: [.organic_results[:5] | .[] | {pos:.position, link, title}]}'
```

**Find the commercial vs. informational split** — count product/shopping vs. blog/editorial results:
```bash
mcp__plugin_agent-kevin_kevin__serpapi_search reed diffuser \
  | jq '.organic_results | map(.displayed_link)'
```

**Mine People Also Ask for content outlining**:
```bash
mcp__plugin_agent-kevin_kevin__serpapi_search how to make laundry soap \
  | jq '.related_questions[] | .question'
```

**Desktop vs. mobile SERP delta** (two calls, ~$0.01 × 2 depending on plan):
```bash
mcp__plugin_agent-kevin_kevin__serpapi_search non toxic air freshener --device=desktop > /tmp/d.json
mcp__plugin_agent-kevin_kevin__serpapi_search non toxic air freshener --device=mobile  > /tmp/m.json
jq -n --slurpfile d /tmp/d.json --slurpfile m /tmp/m.json \
  '{desktop_features: $d[0].serp_features, mobile_features: $m[0].serp_features,
    desktop_top5: [$d[0].organic_results[:5] | .[] | .displayed_link],
    mobile_top5:  [$m[0].organic_results[:5] | .[] | .displayed_link]}'
```

**AI Overview impact check** — if `ai_overview.present` is `true` and we're not a reference, that's a zero-click risk to prioritise.

## When to use vs not

- ✅ "Who's ranking for this query?" → `search`, inspect `organic_results`.
- ✅ "Is Google showing an AI overview / shopping carousel / PAA?" → `search`, inspect `serp_features`.
- ✅ "What does the mobile SERP look like vs. desktop?" → two calls with `--device`.
- ✅ "What do users search for next?" → `related_searches`.
- ✅ "What questions should a piece of content answer?" → `related_questions` (PAA).
- ❌ "What's our traffic / CTR / indexing status?" — that's GSC, not SERP.
- ❌ "Tell me about X" — use Perplexity. SerpAPI is SERP structure, not content synthesis.
- ❌ "Is this page fast?" — that's `google-page-speed`.
