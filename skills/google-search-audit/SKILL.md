---
name: google-search-audit
description: Read-only SEO audit for the site configured in GSC_SITE_URL. Pulls GSC + PageSpeed + WordPress (if applicable) + on-demand SerpAPI for anomaly investigation, applies four audit rules, ranks findings by impact, writes a markdown report, and threads notes into any matching active tasks. Diagnostic-only — never publishes or edits. Invoke on demand or wire to any scheduler (cron, GitHub Action, etc.). Trigger phrases — "run the SEO audit", "audit the site", "gsc audit", "search console audit".
disable-model-invocation: true
allowed-tools: mcp__plugin_agent-kevin_kevin__gsc_query, mcp__plugin_agent-kevin_kevin__gsc_inspect, mcp__plugin_agent-kevin_kevin__gsc_sites, mcp__plugin_agent-kevin_kevin__page_speed_audit, mcp__plugin_agent-kevin_kevin__page_speed_psi, mcp__plugin_agent-kevin_kevin__serpapi_search, mcp__plugin_agent-kevin_kevin__browser_screenshot, mcp__plugin_agent-kevin_kevin__task_query, mcp__plugin_agent-kevin_kevin__task_thread, Read, Write, Edit, Glob, Grep, Bash(curl *), Bash(date *)
---

# Google Search Audit

Read-only SEO audit for your configured site. Diagnostic — surfaces problems for you to action manually. Never publishes or edits anything live.

Run on demand whenever you want a check-in, or wire it to an arbitrary scheduler (cron, GitHub Action, launchd, CI step, etc.) at any cadence — daily, weekly, post-deploy, ad-hoc. The skill is stateless apart from the audit file it writes; prior audit files in the same directory are picked up automatically for trend comparison.

## Prerequisites

- `GSC_SITE_URL` set in `<HOME>/.claude/settings.local.json` env block (this is the site under audit)
- Google OAuth completed — run `mcp__plugin_agent-kevin_kevin__google_auth` once if you haven't
- Optional: `SERPAPI_KEY` configured — without it, the audit skips SERP-investigation steps for anomalies (everything else still works)

If `GSC_SITE_URL` isn't set, stop and tell the user to run `/agent-kevin:configure-skills` → SEO pack to configure it.

## Step 1 — Load context

- Resolve `$SITE` = value of `GSC_SITE_URL` (e.g., `https://example.com/`)
- Compute `$SITE_SLUG` = domain without protocol, lowercase, `-` for dots (e.g., `example-com`)
- Look for a matching project: scan `<HOME>/projects/*/README.md` for any that references `$SITE` or contains `$SITE_SLUG` in the directory name. If found, set `$PROJECT_DIR = <HOME>/projects/<matched-slug>/` and read its `README.md` plus any `PRIORITY-PAGES.md` / `priority-pages.md` for context (vision, focus pages).
- If `$PROJECT_DIR/audits/` exists, read the **three most recent** audit files (excluding any `TEMPLATE.md`) — used for trend comparison vs last audit.

If no matching project exists, the audit still runs — output just lands in `<HOME>/knowledge/raw/inbox/` instead.

## Step 2 — Data pulls

1. **GSC** — last 28 days. Use today and today-28d as the range. Two queries:
   - `mcp__plugin_agent-kevin_kevin__gsc_query` with `{ startDate, endDate, dimensions: ['query', 'page'] }`
   - `mcp__plugin_agent-kevin_kevin__gsc_query` with `{ startDate, endDate, dimensions: ['page'] }`
   - Focus on the **top 30 pages by impressions**.
   - Also pull the previous 28 days for week-over-week comparison.

2. **WordPress REST** (skip cleanly if non-WP):
   ```bash
   curl -sS -f "$SITE/wp-json/wp/v2/posts?per_page=100&_fields=id,slug,link,modified,title" || echo "NOT_WORDPRESS"
   curl -sS -f "$SITE/wp-json/wp/v2/pages?per_page=100&_fields=id,slug,link,modified,title" || true
   ```
   If `NOT_WORDPRESS`, skip Rule 4 (which depends on `modified` dates) and continue.

3. **Rendered `<title>` and `<meta name="description">`** — for each top-30 URL:
   ```bash
   curl -sS -L --max-time 15 "<url>" | grep -E '<title>|<meta name="description"'
   ```
   SEO plugins (Yoast, RankMath, The SEO Framework, AIOSEO) inject meta into the rendered HTML — NOT into the REST response. Always read the rendered page. For stubborn pages (JS-rendered titles), fall back to `mcp__plugin_agent-kevin_kevin__browser_screenshot` to confirm what users see.

4. **PSI** — `mcp__plugin_agent-kevin_kevin__page_speed_audit` for the **top 5 pages by impressions**. (PSI quota is forgiving, but five is plenty for trend.)

5. **Active tasks** (only if `$PROJECT_DIR` was found) — `mcp__plugin_agent-kevin_kevin__task_query` with `{ project: '<slug>', status: 'active' }` and `{ project: '<slug>', status: 'open' }`. Index by page URL/slug for the threading step below.

6. **SerpAPI** (on demand, cost-aware) — when a finding calls for SERP investigation:
   - ranking slipped with no title issue
   - CTR collapsed at a strong position (top 5)
   - clicks halved on flat impressions
   - top query intent appears to have shifted

   Run: `mcp__plugin_agent-kevin_kevin__serpapi_search` with `{ query: '<top-query>', device: 'mobile' }` to see competitors, SERP features (AI overview, shopping carousel, PAA), and intent shifts.

   **Each call costs one SerpAPI search** — use ONLY on flagged anomalies, never on every top-30 page. If `SERPAPI_KEY` isn't configured, just note "SERP investigation skipped (no SERPAPI_KEY)" in the relevant finding's diagnosis.

   **Do NOT screenshot Google SERPs with playwright** — CAPTCHA blocks it reliably.

## Step 3 — Audit rules

Fire these rules on every top-30 page:

- **Rule 1** — `impressions > 1000` AND `ctr < 1%` AND top query for that page NOT present in `<title>`
- **Rule 2** — top-10 ranking page where `gsc_inspect` verdict ≠ `"URL is on Google"` OR slug missing from sitemap (check `$SITE/sitemap_index.xml` or `$SITE/sitemap.xml`)
- **Rule 3** — meta description missing OR > 160 chars OR duplicate across pages (compare across all top-30)
- **Rule 4** — `impressions > 1000` AND `modified` date > 180 days ago (skip if `NOT_WORDPRESS`)

## Step 4 — Impact ranking

For each finding:

```
impact = log10(impressions) × ctr_gap × fix_effort_weight

fix_effort_weight =
  1.0  if Rule 1 or Rule 3 (title/meta — fast wins)
  0.6  if Rule 2 (content/indexability)
  0.3  if Rule 4 (structural / requires content refresh)

ctr_gap = max(0, expected_ctr_at_position − actual_ctr)
  (rough expected: pos 1 → 30%, pos 2 → 15%, pos 3 → 10%, pos 4-5 → 6%, pos 6-10 → 3%, pos 11+ → 1%)
```

Keep the **top 10** findings by impact.

## Step 5 — Thread findings into matching tasks (optional)

For each finding whose page URL or slug matches an existing active task in `$PROJECT_DIR`:

- Append an `[!info] kevin · <ISO timestamp>` block to that task's `## Thread` section
- Do NOT mutate frontmatter
- Use `mcp__plugin_agent-kevin_kevin__task_thread` with `{ id: '<task-id>', author: 'kevin', message: '<finding summary + numbers>' }`

This keeps action items in the user's existing task flow instead of duplicating them in the audit file.

## Step 6 — Write the audit file

Path:
- If `$PROJECT_DIR` exists → `$PROJECT_DIR/audits/YYYY-MM-DD.md` (create `audits/` dir if missing)
- Otherwise → `<HOME>/knowledge/raw/inbox/seo-audit-<SITE_SLUG>-YYYY-MM-DD.md`

File shape:

```markdown
---
title: SEO audit — <site domain> — <YYYY-MM-DD>
site: <$SITE>
range: <start> to <end> (28 days)
created: <today ISO>
findings: <N>
---

# SEO audit — <site domain> — <YYYY-MM-DD>

## Summary

- Top 30 pages by impressions audited
- <N> findings total (<R1 count> Rule 1 · <R2 count> Rule 2 · <R3 count> Rule 3 · <R4 count> Rule 4)
- Top action: <one sentence — the highest-impact fix>

## Top findings (ranked by impact)

### 1. /<slug>/   `<impact score>`

| metric | 28d | Δ vs prev 28d |
|---|---|---|
| impressions | <N> | <+X% or −X%> |
| clicks | <N> | <±X%> |
| ctr | <N>% | <±X pp> |
| position | <N.N> | <±X.X> |

- **Rule:** <which rule fired>
- **Diagnosis:** <2-3 sentences. If SerpAPI was used, include competitor / SERP feature context here.>
- **Fix:** <one sentence starting with a verb — "Swap title to …", "Rewrite meta as …", "Investigate SERP intent before rewriting …">

### 2. ...

(...up to 10)

## Trends

<one short paragraph on the WoW pattern worth watching — site-wide CTR shift, position drift on a cluster, etc.>

## Next action

<one sentence — the single most impactful thing to tackle this week>
```

Use `−` (U+2212), not `-` (hyphen), for negative deltas. Right-align numbers in the table is fine in markdown rendering.

## Step 7 — Empty audit

If nothing substantive surfaces (all rules green, no WoW movement worth reporting), output to the user:

> All clear for `<site domain>` this week. Audit file written to `<path>` for the trail.

And still write the audit file with `findings: 0` in frontmatter and just the `## Summary` section populated. The empty trail is itself useful — confirms the run happened.

## Anti-patterns

- ❌ **Don't invoke** `seo-content-writer`, `content-quality-auditor`, or `marketing-skills` in this pass. This audit is diagnostic — it surfaces problems. Those skills are for the follow-up rewrites/scoring once the user picks what to action.
- ❌ **Don't publish or edit pages.** Read-only.
- ❌ **Don't fan out SerpAPI calls** across every top-30 page. Each costs a query. Only on flagged anomalies.
- ❌ **Don't try to screenshot Google SERPs** with playwright — CAPTCHA blocks it. Use SerpAPI for SERP data.
- ❌ **Don't auto-update task frontmatter** when threading. Only append to `## Thread`.
- ❌ **Don't write to `<HOME>/projects/` if no matching project was found.** The fallback path is `<HOME>/knowledge/raw/inbox/` — that's where standalone audits live until promoted.
