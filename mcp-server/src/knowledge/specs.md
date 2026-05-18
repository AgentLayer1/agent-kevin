You are compiling an implementation spec or protocol document into Kevin's
knowledge wiki. The spec has been implemented (or is being adopted); your job
is to preserve its **durable reasoning** — the patterns, principles, and
decisions that will still matter in six months — before the raw file is
consumed.

## Current wiki index (the manifest)

This is the canonical list of every permanent article, including all existing concepts. **Use the `Read` tool to fetch the full content of any concept you plan to update or extend.** If the spec reinforces an existing concept, read it first and append rather than create a new one.

{{wikiIndex}}

## Spec to compile

**File:** `{{fileName}}`

{{specContent}}

## Your task

Distil this spec into one or more concept articles under
`{{knowledgeDir}}/concepts/`. After this compile run the raw file will be
moved to `{{archivedRelPath}}` — so cite the archived path (not
`raw/specs/...`, which won't exist anymore):

```yaml
---
title: <Title>
sources: [{{archivedRelPath}}]
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
---
```

**Rules:**

1. **Prefer updating existing concepts** when the spec reinforces or extends
   a pattern already documented. Read the existing article first. Append the
   source filename to its `sources:` array if that's how it got updated.
2. **Create new concepts sparingly** — only for patterns that cross-cut
   projects, or principles worth naming and referring to later. A spec
   describing one feature of one project rarely produces a durable concept.
3. **Extract these things:** architectural decisions with rationale,
   recurring patterns, non-obvious tradeoffs, invariants, naming
   conventions that will outlive the current implementation.
4. **Skip these things:** step-by-step task lists, phase-by-phase schedules,
   narrative prose, one-off implementation details, interview transcripts.
   Those are git-log / session-log territory — not concept material.
5. **Encyclopedia tone** — factual, self-contained, scannable. Use
   `[[concepts/<slug>]]` wikilinks for
   cross-references.
6. **Keep the manifest current.** If you create a new concept, add a bullet to the `## Concepts` section of `{{knowledgeDir}}/index.md` with a wikilink and a one-line description. The index IS the manifest — every future compile uses it as the canonical pointer list, so any article missing from the index is invisible to the next pass.
7. **If nothing distillable emerges** — no durable pattern, no cross-cutting
   principle, nothing non-obvious — write no articles. Respond with a short
   explanation of why. The raw file will be consumed either way; a clean
   rejection is the right outcome for a thin spec.

Quality bar: would a new contributor reading the resulting concept in six
months say "that's useful, I didn't know that"? If no, don't write it.
