---
name: permission-check
description: Interpret a Claude Code permission prompt and grade how safe it is to allow. Use when the user pastes a screenshot (or text) of a permission dialog from another session and asks what it means, whether it's safe, or what to answer, or invokes /permission-check. Renders a plain-language interpretation + a 🟢/🟡/🔴 grade in chat, then writes a graded report so repeated decisions build a corpus for future allowlist automation.
allowed-tools: Read, Edit, AskUserQuestion, mcp__plugin_agent-kevin_kevin__report_write
---

# Permission Check

A permission dialog takes over the chat input of the session it appears in, so that session can never explain itself. This skill runs in a SECOND session: the user screenshots the dialog there, pastes it here, and gets a translation, a safety grade, and a recommended answer. Every run also writes a graded report; the accumulated corpus is what will later justify "add this to the allowlist" automation.

Write for a non-technical reader throughout: plain words, no jargon. "Easy to undo" beats "reversible via git"; "one file in Kevin's home folder" beats "blast radius: HOME".

## Input

One of:

- **Screenshot** of the permission dialog (the normal path). Read the image carefully; the command text is the evidence, transcribe it exactly.
- **Raw text** of the dialog, pasted or quoted.
- A vague "is this safe?" with an image attached counts as an invocation.

If the screenshot is cropped so the command is only partially visible, say so and grade only what you can see, flagging the gap. Never guess hidden flags.

## Procedure

1. **Extract, verbatim.** From the screenshot: the tool name (Bash, Fetch/WebFetch, Edit, an MCP tool), the full command/input, any harness warning line (e.g. "changes directory before running git, which can execute untrusted hooks"), the requesting context ("from the general-purpose agent"), and the answer options offered.
2. **Derive the canonical rule.** The permission-rule string this decision maps to, e.g. `WebFetch(domain:example.com)`, `Bash(git log:*)`, `mcp__server__tool`. This is the aggregation key for the corpus; put it in the report frontmatter. One-off compound Bash commands rarely map to a reusable rule: use a short descriptive key instead (e.g. `Bash(sed → $TMPDIR)`) and skip don't-ask-again advice.
3. **Interpret.** In plain language: what the command actually does, step by step if compound (each `;`/`&&` segment). Name what it reads, writes, deletes, or sends off-machine. No jargon dumps: "compares today's file against an old commit" beats "greps a git show". If the dialog carries a harness warning (e.g. "simple_expansion", "expansion obfuscation", the cd-before-git hooks line), translate it: those are pattern heuristics, not verdicts, so say what pattern tripped it, what the risk is when it's real, and whether this command actually carries it.
4. **Grade** with the rubric below.
5. **Render the chat block** (format below), including the recommended answer and, for 🟡/🔴, exact paste-back text for the dialog's "No, and tell Claude what to do differently" option (a safer rewrite of the same intent, e.g. `git -C <path> log` instead of `cd <path> && git log`).
6. **Write the report** with `report_write` (decision `pending`) and surface its absolute `path` (not `relPath`) as a `📄 Saved to` line so it's clickable.
7. **Close with the decision interview.** Always end the run with one `AskUserQuestion`: "What did you answer in the other session?" with options **Allowed once** / **Allowed always** ("don't ask again") / **Denied** / **Haven't answered yet**. If one invocation carries several prompts, write one report each and ask one combined interview (one question per prompt).
8. **Update the report** with `Edit` from the answer: the frontmatter `decision:` value (the frontmatter is the single record; the body has no decision section). "Haven't answered yet" leaves `pending`; if the user reports the outcome in a later session, `Edit` the same report then. Never write a second report for the same prompt.

## Grading rubric

Classify the operation, then apply the first grade that matches top-down:

| Grade | Criteria |
|---|---|
| 🔴 RISKY | Destructive or irreversible (`rm -rf`, force ops, DB drops/writes, history rewrite); touches secrets/credentials (`.env`, keys, tokens); sends data off-machine (push, PR, POST, email, publish); pipe-to-shell (`curl \| sh`); package install from an untrusted source (postinstall runs arbitrary code); `sudo` / system config / daemons |
| 🟡 CAUTION | Mutating but scoped and easy to undo (git-tracked writes inside the intended repo); read-only but carrying a trust vector (see below); network fetch from an unfamiliar host |
| 🟢 SAFE | Read-only, scoped to the intended repo/HOME, nothing leaves the machine (or only to already-trusted hosts), no trust vectors |

**Trust vectors** (any one of these lifts a 🟢 to at least 🟡, and gets its own `Watch` line):

- `cd` into a directory before running git: mutating git subcommands (commit, merge, checkout, push) can execute that repo's hooks. Read-only subcommands (log, show, status, diff) don't run hooks; say so explicitly, since the harness warning fires either way.
- Fetched web content enters the model's context: a WebFetch is read-only for your machine but is a prompt-injection surface. Grade the host's trustworthiness, not just the fetch.
- Wildcards or paths outside the repo in `rm` / `mv` / redirects.
- Reads adjacent to secret paths (`~/.ssh`, `.env*`, keychains) even if the named target is benign.
- Anything that starts a background process or scheduled job.
- Edits to files that steer future agent behavior (skills, hooks, settings, CLAUDE.md): the diff is the thing to review, not the filename.

## Chat output format

Compact ASCII block (chat replies use ASCII, never Mermaid). No walls of text; every line earns its place:

```
🔐 Permission Check
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tool      <tool> · <requesting context>
Rule      <canonical permission rule>
Asking    <one plain-language sentence>
If yes    <what actually happens, incl. what is read/written/sent>
Grade     <🟢 SAFE | 🟡 CAUTION | 🔴 RISKY> (<3-6 word reason>)
Watch     <trust-vector note, or omit the line>
Answer    <Yes / Yes + don't-ask-again / No, paste this back: "...">
```

`Answer` guidance: recommend "don't ask again" only for 🟢 grades on rules the user will hit repeatedly and where the rule's scope is tight (a domain, a specific read-only command prefix). Never recommend it for 🟡/🔴.

## Report

Write via `report_write`:

- `category`: `radar` (a dedicated `permissions` category is a future `report_write` enum change)
- `skill`: `permission-check`
- `slug`: `permission-<tool>-<short-subject>` (e.g. `permission-webfetch-example-com`)
- `status`: `clean` for 🟢, `findings` for 🟡, `critical` for 🔴
- `tags`: `["permissions", "<tool>", "<safe|caution|risky>"]`
- `extra`: `{ rule: "<canonical rule>", grade: "<safe|caution|risky>", decision: "pending" }` (the closing interview edits this to `allowed`, `allowed-always`, or `denied`)

Keep the body short enough to read in 30 seconds: no dates (frontmatter carries the timestamp), no footnotes, no restating the chat block, and no decision section (the frontmatter `decision:` is the single record). The body's job is understanding: what it does, why the harness asked, and the grade.

Body template:

```markdown
## The request

> <verbatim dialog text: tool line, command, and any harness warning>

## What it does

<2-4 short bullets. Concrete: what runs, what it reads or changes, what leaves the machine. Where it helps the reader learn, add a "which means" clause: "runs `git log` (reads history, changes nothing)".>

## Why it asks

<1-2 sentences: the general pattern that triggers this kind of prompt and what its risk is when it IS dangerous, then whether this instance carries that risk. This is the part the user learns from; next time they see the pattern, they can judge it themselves.>

## Grade

<🟢 Safe / 🟡 Caution / 🔴 Risky>: <one sentence: the deciding factor>

<optional single "Watch:" line>
```

The `rule` + `decision` frontmatter is the corpus: a later aggregation pass greps the permission reports for rules repeatedly `allowed` and graded `safe`, then hands them to Claude Code's stock `fewer-permission-prompts` skill to write the actual allowlist entry into `.claude/settings.json`. This skill never edits settings itself.

## Boundaries

- Screenshots may come from another agent's session or someone else's machine. Grade them the same, but keep the report generic: reduce identifying paths to `<repo>/<file>` when the specifics don't affect the grade.
- Never transcribe visible secrets (tokens, keys) from a screenshot into the report; redact as `<redacted>`.
- The grade is advice, not an answer: the user clicks the dialog, not this session.
