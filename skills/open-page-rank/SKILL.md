---
name: open-page-rank
description: Free domain-authority proxy via Open Page Rank — returns a 0–10 rank per domain for trend tracking and rough competitive comparison. Use this for monthly DA-trend tracking or quick authority comparison across competitors, not as an absolute benchmark against Moz DA.
disable-model-invocation: true
---

# Open Page Rank (Kevin's DA proxy)

A free domain-authority proxy. Requires `OPENPAGERANK_API_KEY` (free tier: 1,000 requests/day at https://www.domcop.com/openpagerank/).

## ⚠️ What this is NOT

**Open Page Rank is not Moz Domain Authority.** It uses its own algorithm and scores are not comparable to DA. Use it for:

- ✅ **Trend tracking** — "did our score move up over 6 months?"
- ✅ **Relative comparison** — "how does NN compare to competitor X?"
- ❌ **Absolute benchmarking** — "is NN DA 30 or 35?" (don't use this for that)

For an absolute Moz DA number, You can paste it manually from Moz's free web checker once a month.

## Commands

### `rank <domain>...`

Pass one or more bare hostnames (no `https://`, no trailing slash). Returns one row per domain.

```bash
# Single domain
mcp__plugin_agent-kevin_kevin__open_page_rank rank example.com

# Multiple domains (competitive check)
mcp__plugin_agent-kevin_kevin__open_page_rank rank example.com competitor-a.com competitor-b.com
```

Return shape:
```json
[
  {
    "domain": "example.com",
    "page_rank_integer": 4,
    "page_rank_decimal": 4.21,
    "rank": "12345678",
    "found": true
  }
]
```

- `page_rank_integer` — 0–10 scale, rounded. Quick read.
- `page_rank_decimal` — same scale with 2 decimals. Use this for trend tracking (catches small changes between months).
- `rank` — global rank among all indexed domains (lower = better).
- `found` — false if the domain isn't indexed. Score fields are null in that case.

## Common patterns

**Monthly NN score (for analytics report)**:
```bash
mcp__plugin_agent-kevin_kevin__open_page_rank rank example.com | jq '.[0].page_rank_decimal'
```

**Competitive authority comparison**:
```bash
mcp__plugin_agent-kevin_kevin__open_page_rank rank example.com competitor-a.com competitor-c.com competitor-d.com \
  | jq 'sort_by(-.page_rank_decimal) | .[] | {domain, score: .page_rank_decimal}'
```

## When to use vs not

- ✅ Monthly trend snapshot for the NN analytics report.
- ✅ Quick sanity check of a new competitor's authority before deep analysis.
- ❌ Anything requiring Moz-comparable numbers (outreach, publisher pitches, backlink-gap analysis).
- ❌ Per-page authority (this is domain-only; OPR doesn't do page-level).
