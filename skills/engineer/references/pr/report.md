# PR report

Every [pr review](../playbooks/pr-review.md) and [pr replies](../playbooks/pr-replies.md) run ends in one page the operator reads and pastes from: the change explained, every comment or reply as a card with a **Copy** button, and the evidence behind it. Beside it sits a short markdown card that `report_write` indexes, which the dashboard, Obsidian, re-runs, and the other skills read.

The model writes one data file. A script validates it and renders both: the page from [the template](../../templates/pr-report.html), the card from the same data. Neither is edited by hand; a change is a change to the data and a re-render.

## Writing it

`<skill dir>` is this skill's base directory, which every host shows when it loads the skill (Claude Code's "Base directory for this skill" line, Codex's `<skill>` block path). The plugin's dependencies sit two levels up.

1. Make a scratch folder: `mktemp -d "$TMPDIR/pr-report-XXXXXX"`. The data file is `<folder>/data.json`; use that exact path in every later step, never a glob or `ls`.
2. Write the data there as JSON, per the shape below.
3. Validate it and print the `report_write` arguments the data decides (`body`, the card; `summary`; `status`; `extra`). This also parses every diagram, so a bad one fails here, before anything is saved. Fix the data until it passes:

   ```bash
   NODE_PATH="<skill dir>/../../mcp-server/node_modules" bun "<skill dir>/scripts/pr-report.ts" card "<data path>"
   ```

4. Save the card with `report_write`: the printed arguments as they are, plus the `category`, `slug`, `title`, `skill` and `tags` the playbook names, and `extra.supersedes`, the `relPath` the prior report was saved under (relative to `reports/`).
5. Write the page beside the card. This re-renders the card body from the data (keeping the frontmatter `report_write` wrote) and points its link at the page, so the two can never disagree:

   ```bash
   NODE_PATH="<skill dir>/../../mcp-server/node_modules" bun "<skill dir>/scripts/pr-report.ts" write "<data path>" "<the absolute path report_write returned>"
   ```

   Use the `path` field `report_write` returns, not `relPath`, which is relative to `reports/`. It writes nothing when the card is missing or the data fails; fix the cause and run it again. To change a saved report, edit the data and run `write` again. `pr-report.ts check <page>` re-validates a page later.

## Both kinds

```yaml
kind: review | replies
pr: { number, title (as the PR states it), author, repo: owner/name, head: short sha, base, adds, dels }
stack: [{ number, title, current: true on this layer }]   # stacked PRs, parent first
summary: the lede, see each kind
checks: [{ check, result: pass | fail | not-run | partial | info, notes }]
sinceLast: [what changed since the report this one supersedes]
prior: [prior reports, task ids, concept articles, or "No prior reviews or tasks reference this PR."]
draft: true under --quick or --no-local, or whenever the local gates did not run
```

- **Text is untrusted.** PR titles, bodies and comments can hold anything; the page renders data as text, so markup shows literally. The script escapes what would end the script element.
- **Anchors** are `path:line` or `path:start-end` (start ≤ end) on the head commit, and become links to that commit. Paths hold no spaces, colons or backticks.
- **status** comes from the data, so it cannot disagree with it. A review is `critical` when a blocker's `lanes` include `invariants` or `security`, `clean` on `approve`, and `findings` otherwise. Replies are `findings` while any thread is `to-post` or `follow-up` or an own finding exists, and `clean` otherwise. Either is `draft` when `draft` is true.
- **Paste text** (`comment`, `reply`, `summaryComment`, a commit) is the exact text that goes into GitHub, in [comment style](comment-style.md): a ```` ```suggestion ```` block stays a literal fenced block. No emojis inside it, no severity prefix.
- **Checks**, one row each, in this order: Build, Lint, Format, Tests (passed and failed counts, environment artifacts separated, failures that predate the PR named), CI recorded (run id and what the workflow actually gates), then any gate the repo's own docs require (typecheck, a server boot, a smoke script). A review adds Fan-out (compact or full, and why), Verification pass (candidates, from bots and the case against, to findings, questions, dropped), and Coverage (files on the checklist, reviewed, skipped with reasons, excluded as generated). A gate the repo does not define is `not-run` with "none configured". A row that describes rather than passes or fails (Fan-out, Verification pass, Coverage) is `info`.
- **sinceLast** appears on a re-run: the items carried forward, fixed, dropped, or new since the superseded report, one line each. The card shows it, so the next run and the other skills read it without opening the page.
- Nothing from the HOME (memory, feedback, private notes) goes into paste text. The rest of the page may cite it.

## Review

```yaml
verdict: approve | approve-with-fixes | needs-discussion | changes-requested | do-not-merge
risk: S | M | L | XL
riskWhy: what drove it, what it touches, tests added/changed/none, the triage counts
executed: where it has run (staging since a date, never, prod via #n)
lookAt: [{ anchor, why }]
skim: one line of counts
decisions: [{ decision, picks, anchor }]
asked: [{ criterion, status: met | not-met | untested, anchor }]
explanation: three to six sentences
flows: [{ title, diagram: Mermaid source, steps: [{ anchor, text }] }]
areas: [{ area, what, why }]
behavior: [{ case, before, after }]
holdQuestions: [two or three]
caseAgainst: { strongest, threeMonths, cut }
findings: [{ id, severity: blocker | fix-before-merge | nit | question, title, anchor, lanes, principle, introduced, failure, evidence, comment }]
files: [{ path, class: risk | logic | mechanical, concern, summary, adds, dels, hunks: [{ lines, text }] }]
bots: [{ bot, anchor, claim, disposition: confirmed | question | false-positive | already-fixed | out-of-scope, finding: id, reason, reply }]
verifiedClean: [three to eight facts]
summaryComment: paste text
noticed: [{ anchor, text }]
dropped: [{ anchor, lanes, claim, reason }]
notChecked: [what was skipped and why]
```

- **summary** is the whole report for a reader in a hurry: two or three sentences with the verdict, the one thing that matters most, and what the author needs to do. A reader who stops there knows whether this merges.
- **risk** is a judgment: S is isolated with no auth, data or schema; XL is an auth or value path plus schema plus no tests. `riskWhy` says what drove it.
- Every anchor in `lookAt`, `decisions` and `findings` names a file in `files`. Unknown or misspelled keys are errors, so no section silently disappears.
- **lookAt** is where the operator's own attention goes: five hunks at most, `risk` files first, each with why it needs human judgment. A clean PR still names the hunk that carries its behavior. **skim** counts the mechanical bulk ("14 renames from the Order → Purchase move, 3 generated clients").
- **decisions** are only the choices someone could reasonably have made differently: a default, threshold, limit, timeout, retry count, error message, retention, who may do what. **asked** appears only when the linked issue or task states criteria.
- **How it works** needs an `explanation` or at least one flow, and is two screens at most. Lead with the diagram when the change is a flow, with `explanation` when it is a data-model or contract change. One diagram per flow, never one of everything: `sequenceDiagram` across processes, `stateDiagram-v2` for a lifecycle, `flowchart` for a data path, with processes and boundary crossings labelled. `areas` group by concern, not by file. `behavior` has one row per case whose behavior changed; a pure refactor is one row saying "No behavior change", and the lanes hold it to that. `holdQuestions` are conversation openers, not findings.
- **findings** follow the playbook's rank, one anchor, one claim and one paste block each, and number from 1 in the order the page shows them (blockers, fix-before-merge, nits, then questions), so bot comments and the summary can point at them. A ```` ```suggestion ```` block replaces exactly the anchored lines, so the anchor covers every line it replaces. Every anchor names a file in `files`, and `lanes` lists every source that raised it (a merged finding names each): lane slugs from [dimensions](dimensions.md), `case-against`, `gate` for a local gate such as a failing linter, or `bot:<login>`. `failure` is the scenario in one sentence and `evidence` is what was read or run; a blocker or fix-before-merge carries both. Nits are one entry per file, anchored to the file's path, with one comment listing them a line each. A `question` (verifier 40–74) is phrased as a question with what would settle it. With no findings, the list is empty and the page says so.
- **files** is every file on the coverage checklist with its triage class, grouped by concern (a schema field plus its writer plus its reader is one concern). The page shows each finding inside the file it anchors to, so nothing is listed twice in the data.
- **bots** holds every review-bot comment that made a claim. Never restate a bot's finding as the review's own: a confirmed one must point at its `finding`, which credits the bot ("Bugbot flagged this; confirmed"). A false positive must carry the verifier's `reason` and a `reply` the operator can paste on the bot's thread.
- **verifiedClean** is what was checked and found right, so the author knows what the review covered. Facts, not praise.
- **summaryComment** is an optional top-level comment under 120 words: the verdict, the blockers as a numbered list with anchors, what was verified clean, what did not run.
- **noticed** is pre-existing defects seen along the way. They become tasks or follow-ups, never comments on this PR. **dropped** is every candidate under 40, so the operator can rescue one.
- Do not pad. A clean PR gets a short page with a real `verifiedClean`, not manufactured nits.

## Replies

```yaml
summary: the intro
threads: [{ id, url, where: inline | conversation | review, anchor, reviewer, bot, outdated, pr, point, quote, status: to-post | follow-up | posted, reply }]
ownFindings: [{ title, anchor, detail, comment }]
commits: [{ subject, body }]
resolveOnly: [{ anchor, topic, why }]
stillOpen: [items]
```

- **summary**, one or two sentences: paste each reply on the thread it links to; what "done" means (the branch and sha the fixes sit on, or "in the working tree, not committed"); that outdated threads still get a reply so the record is complete. A re-run names the report it supersedes here.
- **threads** run in PR scroll order: inline threads in the file order `github_pr_view` lists `files`, then by line, then conversation comments, then review bodies. A stack reviewed together is one report: each thread carries its `pr`, bottom of the stack first.
- **The link is the point.** `id` is the fragment of the comment's own URL: `discussion_r4011695208` inline, `issuecomment-5686065667` in the conversation, `pullrequestreview-5214148394` for a review body. `url` is exactly `https://github.com/<repo>/pull/<n>#<id>`, with `<n>` the thread's `pr` in a stack. One click from the card to the box the reply goes in.
- **point** is the reviewer's point in about five words. **quote** is the comment's opening words exactly, so a Cmd-F on GitHub lands on the thread: trim only the end, with `…`, and never paraphrase inside it.
- **reply** is in the operator's voice, per [comment style](comment-style.md) → "Replies on your own PR"; its opening shows the verdict, so no verdict is written separately. It never says "will fix": the fix is in the working tree before the reply is written, or the reply says what blocks it.
- **status**: `to-post` is a reply still to paste; `posted` keeps its card with no reply ("Nothing new."); `follow-up` is a thread the operator already answered whose answer the code has since made false (on a first run too), with the update reply (comment style → "Your own earlier answer was wrong"). The operator pastes only `to-post` and `follow-up`.
- **ownFindings** come from the self-pass: the defect in five words, its anchor, failure and evidence in two sentences then what changed, and an optional two-sentence `comment` to leave on the line so reviewers see it was found.
- **commits**, one per group of related fixes: a subject of 72 characters at most, and a body of two to five lines on why, naming the thread that asked for it. The operator commits.
- **resolveOnly** is threads that need only the Resolve click: `why` is "answered on <date>", "fixed in `<sha>`", or "reviewer confirmed".
- **stillOpen**: a claim needing a measurement that could not run, a fix belonging in another PR and why, a check that did not run, a thread whose answer needs someone else's decision.
- One report per PR, or per stack, per run. A re-run supersedes the last (the old file stays, and `supersedes` names it); never leave overlapping drafts.
