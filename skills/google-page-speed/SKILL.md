---
name: google-page-speed
description: Run Google PageSpeed Insights (Lighthouse performance scores + Core Web Vitals — LCP, CLS, INP, FCP, TBT, SI) for any public URL via `bun run dispatch google-page-speed`. Use this whenever performance or Core Web Vitals evidence is needed (auditing a specific page, diagnosing ranking drops, comparing mobile vs desktop).
disable-model-invocation: true
---

# Google PageSpeed Insights (Kevin's performance plugin)

Lighthouse-backed performance audit for any publicly reachable URL. Uses the free PSI v5 API (25k requests/day per OAuth project).

Authenticates via the shared Google OAuth client — the same one Search Console uses. If you've already run `mcp__plugin_agent-kevin_kevin__google_auth`, PageSpeed works out of the box. If not, run it once (from either plugin — `bun run dispatch google-page-speed auth` and `mcp__plugin_agent-kevin_kevin__google_auth` are the same command).

Enable the "PageSpeed Insights API" in the same GCP project where the OAuth client was created. No separate API key is needed.

## Commands

Invoke as `bun run dispatch google-page-speed <cmd> [args...]`. Output is always JSON on stdout — pipe through `jq` for filtering.

### `psi <url> [--strategy=mobile|desktop]`

One strategy, returns the high-signal slice only — performance score plus the six Core Web Vitals / performance metrics. Defaults to `mobile` (matches Google's mobile-first ranking).

```bash
# Mobile run (default)
mcp__plugin_agent-kevin_kevin__page_speed_psi https://example.com/topic-keyword-b/

# Desktop
mcp__plugin_agent-kevin_kevin__page_speed_psi https://example.com/topic-keyword-b/ --strategy=desktop
```

Return shape:
```json
{
  "url": "...",
  "strategy": "mobile",
  "performance_score": 78,
  "metrics": {
    "lcp_ms": 2450,
    "cls": 0.015,
    "inp_ms": 180,
    "fcp_ms": 1200,
    "tbt_ms": 340,
    "si_ms": 2800
  },
  "fetched_at": "2026-04-19T08:00:00.000Z"
}
```

### `audit <url>`

Runs mobile + desktop in parallel, returns both in one payload. Use this when you need to compare devices (e.g., diagnosing NN's desktop ranking gap).

```bash
mcp__plugin_agent-kevin_kevin__page_speed_audit https://example.com/topic-keyword-b/
```

Return shape: `{ "mobile": {...}, "desktop": {...} }` — each side is the same slice as `psi`.

## Common patterns

**Baseline the top priority pages (parallel, bash style)**:
```bash
for url in /topic-keyword-b/ /topic-keyword-c/ /topic-keyword-d/; do
  mcp__plugin_agent-kevin_kevin__page_speed_audit "https://example.com$url" > "audit-$(basename $url).json" &
done
wait
```

**Mobile-vs-desktop gap (single-liner)**:
```bash
mcp__plugin_agent-kevin_kevin__page_speed_audit https://example.com/topic-keyword-c/ \
  | jq '{mobile_score: .mobile.performance_score, desktop_score: .desktop.performance_score, gap: (.mobile.performance_score - .desktop.performance_score)}'
```

**LCP breakdown across multiple pages**:
```bash
mcp__plugin_agent-kevin_kevin__page_speed_psi <url> --strategy=desktop | jq '{url, lcp_ms: .metrics.lcp_ms, cls: .metrics.cls, inp_ms: .metrics.inp_ms}'
```

## Interpreting the numbers

| Metric | Good | Needs Improvement | Poor |
|--------|------|-------------------|------|
| Performance score | ≥90 | 50–89 | <50 |
| LCP (Largest Contentful Paint) | ≤2500ms | ≤4000ms | >4000ms |
| CLS (Cumulative Layout Shift) | ≤0.1 | ≤0.25 | >0.25 |
| INP (Interaction to Next Paint) | ≤200ms | ≤500ms | >500ms |
| FCP (First Contentful Paint) | ≤1800ms | ≤3000ms | >3000ms |

Google uses Core Web Vitals (LCP, CLS, INP) as direct ranking signals. A page with Good on all three has a measurable edge over one with Needs Improvement or Poor.

## When to use vs not

- ✅ "Why is this page ranking lower on desktop than mobile?" → `audit` to see the gap.
- ✅ "Did my perf fix land?" → rerun `psi` after the change, compare to the pre-change baseline.
- ✅ "Baseline the top 10 pages" → loop `audit` and save to the audits folder.
- ❌ "Run a full Lighthouse report with screenshots" — this plugin returns only the numeric slice. For a full audit use a browser tool.
- ❌ "Monitor performance continuously" — PSI is a point-in-time sample, not a monitor. Pair with CrUX if real-field data is needed.

## Notes

- **Cold cache variance**: PSI scores vary 5–15 points run-to-run, especially on non-cached first requests. For baseline numbers, run 3× and take the median; for regression-check, same.
- **`lighthouseResult.requestedUrl` vs final URL**: if PSI follows redirects, the audit applies to the final URL. If that matters, normalize your input first.
- **Local files not supported**: PSI needs a publicly reachable URL. For local dev, use Playwright + Chrome DevTools Protocol directly.
