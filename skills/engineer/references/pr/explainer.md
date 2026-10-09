# PR explainer

A one-page visual companion to a [pr review](../playbooks/pr-review.md) report, for a PR too big to hold in your head from markdown: what it does as diagrams, where a human should read, and every file on a map. The markdown report stays the record and the paste source; the explainer is what the operator opens first.

## When to write one

Write it when any of these holds, counted from the foundation's coverage checklist:

- at least 400 changed lines outside the files skipped up front (generated, lockfiles, snapshots, vendored);
- at least 15 files on the checklist;
- the PR is one layer of a stack.

`--explainer` writes one regardless; `--no-explainer` and `--quick` never do.

## How to write it

1. Copy [the template](../../templates/explainer.html). It is the design contract: compose its sections, don't redesign the page. Everything renders from the `pr-explainer-data` JSON block; change data, never markup, except the `<title>`.
2. Fill the block from the saved report, not from memory: the same verdict, risk, anchors, findings, and wording. The explainer adds no claim the report doesn't make.
3. Save it beside the report: the report's path with `.md` swapped for `.html`. `report_write` returns the path.
4. Run the check until it passes. `<skill dir>` is this skill's base directory, which every host shows when it loads the skill (Claude Code's "Base directory for this skill" line, Codex's `<skill>` block path); the plugin's dependencies sit two levels up:

   ```bash
   NODE_PATH="<skill dir>/../../mcp-server/node_modules" bun "<skill dir>/scripts/explainer-check.ts" "<explainer path>"
   ```

5. Put the path in the report's Overview table (the **Explainer** row) and in the chat reply.

## Data

```yaml
pr: { number, title, author, repo: owner/name, head: short sha, base, adds, dels }
stack: [{ number, title, current: true on this layer }]   # stacked PRs only, parent first
verdict: approve | approve-with-fixes | needs-discussion | changes-requested | do-not-merge
risk: S | M | L | XL
summary: two or three sentences, the report's summary blockquote
report: the report's file name, so the page links back to it
lookAt: [{ anchor: path:line or path:start-end, why }]     # five at most, risk files first
skim: one line of mechanical counts
decisions: [{ decision, picks, anchor }]
flows: [{ title, diagram: Mermaid source, steps: [{ anchor?, text }] }]   # one per flow, at least one
behavior: [{ case, before, after }]
caseAgainst: { strongest, threeMonths, cut }
files: [{ path, class: risk | logic | mechanical, concern, summary, adds, dels, hunks: [{ lines, text }] }]
findings: [{ severity: blocker | fix-before-merge | nit | question | decision, title, anchor }]
```

- **Flows** are where the explainer earns its keep: one diagram per flow the PR changes (a request path, a job, a state machine), never one diagram of everything. A `sequenceDiagram` for calls across processes, `stateDiagram-v2` for a lifecycle, `flowchart` for a data path. Steps are in code order, each with its anchor.
- **Files** lists every file on the coverage checklist with the triage class, grouped by concern (a schema field plus its writer plus its reader is one concern). Hunks are optional and short: where a reviewer would want to jump in.
- **Text is untrusted.** PR titles and bodies can hold anything. The page renders data as text, so markup shows literally; the only thing to escape by hand is `</` (write `<\/`), which the check enforces.

Anchors become links to the head commit on GitHub when `repo` and `head` are set. Diagrams load Mermaid from a pinned CDN build; offline, each diagram shows its source instead, so the page still reads.
