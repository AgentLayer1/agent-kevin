---
name: morning-briefing
description: Tailored morning brief — signal-topic news, active threads, today's priorities. Run when you sit down at the start of the day and want a quick orient.
disable-model-invocation: true
allowed-tools: mcp__plugin_agent-kevin_kevin__task_query, mcp__plugin_agent-kevin_kevin__task_get, mcp__plugin_agent-kevin_kevin__task_scan, mcp__plugin_agent-kevin_perplexity__perplexity_search, Read, Glob, Bash
---

# Morning Briefing

Compose a tight morning brief that gets you working in 30 seconds. Not an exhaustive status report — just what matters today.

## Inputs to gather (parallel where possible)

1. **Active threads** — read `<HOME>/knowledge/memory/index.md` `## Active Threads` and `## Pending`.
2. **Active tasks** — `mcp__plugin_agent-kevin_kevin__task_query` with `{status: "active"}` and `{status: "open", priority: "P0"}` / `priority: "P1"`.
3. **Overdue + stale** — `mcp__plugin_agent-kevin_kevin__task_scan` for surface items needing attention.
4. **Recent commits** — `git -C <HOME>/knowledge log --oneline -10` and `git -C <HOME>/projects log --oneline -10` (if those repos exist).
5. **Signal news** — read `<HOME>/USER.md` for your interests/signal topics, then call `mcp__plugin_agent-kevin_perplexity__perplexity_search` once with the 2–3 most relevant terms. ONE call. Don't run a fan of searches.

## Compose

Output in this shape (concise — aim for under 30 lines total):

```
☀️ Morning brief — <weekday>, <date>

🔥 Today's priorities (3 max)
  - <task id>: <title> — <why now>
  - ...

🧭 Active threads (2-4 lines)
  - <one bullet per current focus area>

⚠️ Needs attention
  - <overdue task or stale thread>, or "(nothing)"

📰 News (3 lines max)
  - <single most relevant headline + 1-line "so what">
  - <if anything else genuinely moves your needle today>

🎯 Suggested first move
  - <one concrete action — what to type/open/read first>
```

## Anti-patterns

- ❌ Dumping every active task. Cap at 3 priorities.
- ❌ Running perplexity multiple times to cover every signal topic. One pass.
- ❌ Including news that's interesting but doesn't change today's plan.
- ❌ Writing the brief in third person or in a corporate tone. Talk to the user directly.
