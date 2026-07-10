---
name: mermaid
description: Validate and iterate on a Mermaid diagram before it ships. Use whenever authoring or editing a ```mermaid block in a plan, spec, report, task, or knowledge file, so a diagram that fails to render never reaches review. Tier 1 parse-checks every block (fast, headless); Tier 2 renders and visually critiques diagrams headed to a rendered surface. Also runs on /mermaid.
---

# Mermaid

Broken Mermaid is the failure this skill exists to prevent: a diagram that parses in the author's head but throws (or paints nothing) when the reader opens the file. It has shipped before. The fix is a gate, not vigilance: every diagram gets parse-checked before it is presented, and the diagrams that matter visually get looked at.

Two tiers, escalate only as needed:

- **Tier 1 (always): parse-validate.** Cheap, headless, no browser. Catches blocks that would fail to render. This runs on every diagram, no exceptions.
- **Tier 2 (when it matters): visual review.** Render the diagram and actually look at the pixels, then iterate. Only for diagrams headed somewhere the look matters (a deck, a shared spec, a customer surface) or when Tier 1 passes but the diagram is large/complex enough that layout could be wrong.

Terminal and chat replies use ASCII, never Mermaid (it does not render in a terminal). This skill is for Mermaid written into files.

## When it fires

Fires when a ```mermaid block is about to be written or edited into a file: a plan-spec, a report, a task thread, a knowledge article, a README. Fire before the file is handed back for review, not after.

Chat-only diagrams are out of scope: a Mermaid block pasted into a chat reply renders live in the user's client, so a broken one is visible immediately and self-corrects. The gate is for files, where a broken diagram sits unseen until someone opens it.

## Tier 1: parse-validate (always)

1. **Write the diagram into its target file** (or edit the existing one).
2. **Run the validator** against that file:

   ```bash
   NODE_PATH="${CLAUDE_PLUGIN_ROOT}/mcp-server/node_modules" \
     bun run "${CLAUDE_PLUGIN_ROOT}/skills/mermaid/scripts/validate.ts" <file>
   ```

   It extracts every ```mermaid block from the file, runs `mermaid.parse()` on each, and prints one line per block:

   ```
   OK   <file> block 1 (flowchart-v2)
   FAIL <file> block 2 -> Parse error on line 5:
   1/2 FAILED
   ```

   Exit code is non-zero if any block fails. Multiple files can be passed at once.

3. **On FAIL:** read the error and the offending block, consult [references.md](references.md) for the common causes (reserved-word ids, `<`/`>` in labels, unclosed shapes), fix the block, re-run. Loop until `ALL n CLEAN`.
4. **Only present the file once Tier 1 is clean.** A diagram that fails to parse does not go to review.

If the script errors that `mermaid` or `jsdom` cannot be resolved, the plugin's server deps are not installed: run `bun install` in `${CLAUDE_PLUGIN_ROOT}/mcp-server` (redirect bun's cache with `BUN_INSTALL_CACHE_DIR="$TMPDIR/bun-cache" TMPDIR="$TMPDIR"` if the sandbox blocks the default tempdir).

## Tier 2: visual review (when it matters)

Tier 1 proves the diagram renders. It does not prove it looks right: a diagram can parse clean and still be cramped, clip its labels, or vanish on a dark theme. When the diagram is headed to a surface where appearance matters, or it is large enough that layout is a real risk, look at it.

1. **Render the file** with `browser_screenshot` (or `browser_pdf` for a multi-page doc). It writes a PNG/PDF and returns the `path`.
2. **Read the rendered image back** with the Read tool. This is the step that closes the loop: the pixels enter context so the model can judge its own output. Rendering without reading the result back is pointless.
3. **Critique against this checklist:**
   - Are any node labels clipped, overflowing, or overlapping?
   - Is any text too small to read, or invisible against the background?
   - Do the arrows/edges connect the nodes they should, without crossing into a tangle?
   - Is the diagram doing its job: is the relationship it encodes actually legible at a glance?
4. **Iterate:** adjust the source (split a dense graph, shorten labels, add direction hints), re-render, re-read. Stop when it reads cleanly.
5. Re-run Tier 1 after any edit (a visual fix can introduce a syntax error).

Tier 2 is opt-in because rendering spins up chromium, which is heavy. Do not run it on every diagram. Run it when the diagram's appearance is part of the deliverable.

## Reference

Diagram-type selection, authoring rules, and the recurring parse-and-render failure modes with fixes live in [references.md](references.md). Skim it before authoring anything non-trivial; it is faster to pick the right type and avoid the known traps than to debug them.

## Boundaries

- Tier 1 is a syntax gate, not an aesthetic one. It will pass an ugly-but-valid diagram. Aesthetics are Tier 2's job.
- Do not disable a diagram or fall back to ASCII to dodge a parse error. Fix the diagram. ASCII is only for terminal/chat, where Mermaid genuinely cannot render.
- The validator only reads files and imports vendored deps: no network, nothing leaves the machine.
