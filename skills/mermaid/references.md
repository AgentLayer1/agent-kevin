# Mermaid Reference

Authoring aids and failure modes for Mermaid diagrams in plan docs, specs, and knowledge articles. Skim before authoring anything non-trivial: picking the right diagram type and avoiding the known traps is faster than debugging a parse error or an unreadable render.

## Pick the right diagram type

Match the thing you are drawing to the diagram type. Signal words in the intent point the way:

| Signal words | Diagram type | Mermaid keyword |
|---|---|---|
| workflow, process, steps, decision | flowchart | `flowchart TD` / `flowchart LR` |
| API call, interaction, request/response, handshake | sequence | `sequenceDiagram` |
| data model, tables, records, relationships | entity-relationship | `erDiagram` |
| system components, services, boundaries | architecture / flowchart | `flowchart` (grouped with `subgraph`) |
| status transitions, lifecycle, states | state | `stateDiagram-v2` |
| timeline, phases, rollout | gantt | `gantt` |
| classes, types, inheritance | class | `classDiagram` |

If the diagram needs a legend to be understood, it is doing too much: split it into focused views.

## Parse failures (Tier 1 catches these)

The validator throws on these. Fix and re-run.

- **`<` or `>` in a label.** Read as HTML tokens; the parser bails. `B{balance < payout}` fails. Spell it out (`B{balance below payout}`) or quote the label (`B["balance < payout"]`).
- **Unclosed shape.** `C(unclosed` with no closing `)` (or `]`, `}`). Every shape delimiter must close.
- **Reserved words as ids.** A node or `sequenceDiagram` participant named `end`, `Loop`, `Note`, `class`, `graph`, `subgraph` collides with a keyword. Rename the id, keep the reserved word only in the label: `LoopNode["Loop"]`, not `Loop["Loop"]`.
- **Unquoted parentheses or punctuation in a label.** `A[fetch (cached)]` can break. Quote it: `A["fetch (cached)"]`. Same for `:`, `;`, `#`, `&`.
- **`{}` inside a comment.** Curly braces in a `%%` comment are breaking characters. Keep comments plain text.
- **Missing first-line diagram-type declaration.** The first non-comment line must declare the type (`flowchart TD`, `sequenceDiagram`, ...). Without it the parser has no grammar to apply.
- **`end` at column 0 in a flowchart.** Lowercase `end` on its own can be swallowed as a subgraph terminator. Capitalize or give it an id.
- **Special chars in an edge label.** `A -->|is < 0| B` breaks on the `<`. Rewrite in plain words.
- **Raw newline in a label.** Use `<br/>` for a line break inside a label; a raw newline splits the statement.

## Renders-but-wrong (only Tier 2 catches these)

These parse clean, so Tier 1 passes. Only looking at the render surfaces them.

- **Dark-theme invisibility.** A diagram styled for a light background can render as near-invisible text on a dark theme. **Prevent it with an authoring rule: every `classDef` sets an explicit `color:`.** Light fills need dark text and vice versa; omitting `color:` is how text disappears against the background. This turns a Tier-2-catches-it-late problem into one that never happens.
- **Cramped / overlapping layout.** A wide flowchart or a graph with many crossing edges can render as an unreadable tangle even though every line is valid. Add a `direction`, split it into linked sub-diagrams, or switch the layout engine: `elk` (via a `%%{init: {"flowchart": {"defaultRenderer": "elk"}}}%%` header) handles dense graphs better than the default `dagre`.
- **Clipped labels.** Long node text can overflow or truncate depending on the renderer. Shorten the label or restructure.

## Habits that avoid most of the above

- Quote any label containing anything beyond letters, numbers, spaces, and simple punctuation.
- Give every node a short alphanumeric id and put the human text in the label: `db[(Postgres)]`, `svc["Payment Service"]`.
- Set `color:` on every `classDef`.
- Prefer several small diagrams over one dense one: each is easier to parse, render, and read.
- Keep a diagram to one job.
