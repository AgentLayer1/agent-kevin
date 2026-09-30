---
name: seo
description: >
  Search evidence for a site, read-only: a full audit (Search Console + PageSpeed + on-demand SERP
  checks, ranked findings, a written report), Search Console queries and indexing, PageSpeed and
  Core Web Vitals, live Google results through SerpAPI, and domain authority through Open Page Rank.
  Needs the SEO pack's keys; never publishes or edits a site. Triggers on "run the SEO audit", "gsc audit", "search console audit", "how's
  my site ranking", "why did traffic drop", "what queries bring traffic", "is this page indexed",
  "is this page fast", "Core Web Vitals", "what's ranking for <query>", "domain authority", or /seo.
allowed-tools: mcp__plugin_agent-kevin_kevin__gsc_query, mcp__plugin_agent-kevin_kevin__gsc_inspect, mcp__plugin_agent-kevin_kevin__gsc_sites, mcp__plugin_agent-kevin_kevin__google_auth, mcp__plugin_agent-kevin_kevin__page_speed_audit, mcp__plugin_agent-kevin_kevin__page_speed_psi, mcp__plugin_agent-kevin_kevin__serpapi_search, mcp__plugin_agent-kevin_kevin__open_page_rank, mcp__plugin_agent-kevin_kevin__browser_screenshot, mcp__plugin_agent-kevin_kevin__task_query, mcp__plugin_agent-kevin_kevin__task_thread, Read, Write, Edit, Glob, Grep, Bash(curl *), Bash(date *), Bash(jq *)
---

# SEO

Ground truth on how a site shows up in search: what Google reports, how fast the pages are, what ranks next to them, and how much authority the domain carries. Diagnostic only; the operator acts on the findings.

## Help

`/seo help` (or "what can seo do?") asks for the menu: reply with [help](references/help.md) exactly as written and stop.

## Start

1. Match the ask to a playbook below and follow it. A bare `/seo`, or a vague "how's my site doing", is the audit.
2. Each playbook names the key it needs. When one is missing, say which and point to `/agent-kevin:configure-skills` → SEO; don't retry the call.

## Playbooks

| Ask | Playbook |
|---|---|
| "run the SEO audit", "audit the site", "gsc audit", "why did traffic drop", `/seo audit` | [audit](references/playbooks/audit.md) |
| "what queries bring traffic", "is this page indexed", `/seo console` | [console](references/playbooks/console.md) |
| "is this page fast", "Core Web Vitals", "Lighthouse score", `/seo speed <url>` | [speed](references/playbooks/speed.md) |
| "what's ranking for <query>", "is there an AI overview", `/seo serp <query>` | [serp](references/playbooks/serp.md) |
| "domain authority", "compare our authority to competitors", `/seo rank <domain>` | [rank](references/playbooks/rank.md) |

WordPress content (posts, pages, modified dates) is the wordpress-rest skill, whether or not the question is about SEO.

## Every time

- **Read-only.** Nothing publishes, edits a page, or changes a Search Console setting.
- **SerpAPI bills per call.** Search only when the operator asked for SERP data or the audit flagged an anomaly, never across every page.
- **Evidence, not vibes.** Every finding names the numbers and the date range it came from.

## Reply

Each playbook names its output. The audit ends with the report's path.
