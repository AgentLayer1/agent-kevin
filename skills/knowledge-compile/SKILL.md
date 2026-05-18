---
name: knowledge-compile
description: Compile raw session logs, feedback, and specs into structured wiki articles. Orchestrated in this session — MCP returns work items, Claude synthesizes, MCP confirms.
disable-model-invocation: true
allowed-tools: mcp__plugin_agent-kevin_kevin__compile_status, mcp__plugin_agent-kevin_kevin__compile_next, mcp__plugin_agent-kevin_kevin__compile_write, Read, Write, Edit, Glob, Grep
---

# Compile

Compile raw inputs from `<HOME>/knowledge/raw/` into structured wiki articles. The orchestration loop runs in **this session** — the MCP server is pure I/O, no LLM calls.

## Loop

1. Call `mcp__plugin_agent-kevin_kevin__compile_status` to see what's pending.
2. Call `mcp__plugin_agent-kevin_kevin__compile_next`:
   - If `done: true`, you're finished. Stop.
   - Otherwise, item is `{ itemId, kind, fileName, prompt, meta }`. `kind` is `session` | `feedback` | `specs`.
3. **Read the `prompt` field carefully.** It contains:
   - The CLAUDE.md operating manual (how to organise the wiki)
   - The current `USER.md` (who the user is)
   - The current knowledge/index.md
   - Every existing wiki article (markdown-fenced for grounding)
   - The raw source content (session log, feedback log, or spec)
   - Paths to write to
4. Perform the work the prompt instructs — using Read to inspect existing articles, Write/Edit to update them. Common outputs:
   - New entries in `<HOME>/knowledge/memory/YYYY-MM-DD.md` (daily memory; 14-day retention)
   - Updates to `<HOME>/knowledge/memory/index.md` (active threads, recent decisions, learnings)
   - New or updated `<HOME>/knowledge/concepts/<slug>.md` (cross-cutting patterns)
   - Updates to `<HOME>/USER.md` (durable facts about you)
5. After all edits land, call `mcp__plugin_agent-kevin_kevin__compile_write` with the `itemId`. State is updated: session items advance chunk counter (or promote on last chunk); feedback marks hash; specs archive the source file.
6. Goto step 2.

## Boundaries

- **Do not modify the raw source file.** The session log, feedback log, or spec under `raw/` is the input; never edit it. Compilation produces *new or updated wiki articles* and (for specs) archives the source via `compile_write`.
- **One itemId at a time.** Sessions may chunk: `meta.totalChunks > 1` means multiple `compile_next` calls for the same file. The prompt already contains only the current chunk's content — synthesize only what's in this chunk.
- **Idempotency is enforced by hash.** If the source hasn't changed since the last successful compile, `compile_next` won't return it again.

## Stop conditions

- `compile_next` returns `{ done: true }` — work complete.
- Three consecutive errors from any MCP call — stop and surface the error.
- The user interrupts.

## Why this shape

If the synthesis were called inside the MCP server (via the Anthropic SDK), it would bill against API quota. By returning the prompt to the calling Claude Code session, the synthesis runs as a turn in your TUI — billing against your **subscription pool**. The MCP server is pure I/O + state; no LLM call ever happens inside MCP tool handlers.
