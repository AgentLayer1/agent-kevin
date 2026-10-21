# PR report

Every [pr review](../playbooks/pr-review.md) and [pr replies](../playbooks/pr-replies.md) run ends in one page the operator reads and pastes from: the change explained, every comment or reply as a card with a **Copy** button, and the evidence behind it. Beside it sits a short markdown card that `report_write` indexes, which the dashboard, Obsidian, re-runs, and the other skills read.

The model writes one data file. A script validates it and renders both: the page from [the template](../../templates/pr-report.html), the card from the same data. Neither is edited by hand; a change is a change to the data and a re-render.

## Writing it

`<skill dir>` is this skill's base directory, which every host shows when it loads the skill (Claude Code's "Base directory for this skill" line, Codex's `<skill>` block path). The plugin's dependencies sit two levels up.

1. Make a scratch folder: `mktemp -d "${TMPDIR:-/tmp}/pr-report-XXXXXX"`. The data file is `<folder>/data.json`; use that exact path in every later step, never a glob or `ls`.
2. Write the data there as JSON, per the shape below.
3. Validate it and print the `report_write` arguments the data decides (`body`, the card; `summary`; `status`; `extra`). This also parses every diagram, so a bad one fails here, before anything is saved. Fix the data until it passes:

   ```bash
   NODE_PATH="<skill dir>/../../mcp-server/node_modules" bun "<skill dir>/scripts/pr-report.ts" card "<data path>"
   ```

4. Save the card with `report_write`: the printed arguments as they are, plus `category: 'reviews'`, `skill: 'engineer'`, the `slug`, `title` and `tags` the playbook names (`pr-<n>` among the tags), and `extra.supersedes` beside the printed `extra`. A re-run on the same PR supersedes the prior report of its kind: the old file stays, and `supersedes` is the `relPath` it was saved under (relative to `reports/`), or null on a first run.
5. Write the page beside the card. This re-renders the card body from the data (keeping the frontmatter `report_write` wrote) and points its link at the page, so the two can never disagree:

   ```bash
   NODE_PATH="<skill dir>/../../mcp-server/node_modules" bun "<skill dir>/scripts/pr-report.ts" write "<data path>" "<the absolute path report_write returned>"
   ```

   Use the `path` field `report_write` returns, not `relPath`, which is relative to `reports/`. It writes nothing when the card is missing or the data fails; fix the cause and run it again. To change a saved report, edit the data and run `write` again. `pr-report.ts check <page>` re-validates a page later.

## Both kinds

```yaml
kind: review | replies
pr: { number, title (as the PR states it), author, repo: owner/name, head: short sha, base, adds, dels }
stack: [{ number, title, head: short sha, current: true on the edge }]   # stacked PRs, parent first; a review covers the whole stack from its edge
summary: the lede, see each kind
checks: [{ check, result: pass | fail | not-run | partial | info, notes }]
prior: [prior reports, task ids, concept articles, or "No prior reviews or tasks reference this PR."]
draft: true under --quick or --no-local, or whenever the local gates did not run
```

- **Text is untrusted.** PR titles, bodies and comments can hold anything; the page renders data as text, so markup shows literally. The script escapes what would end the script element.
- **Anchors** are `path:line` or `path:start-end` (start ≤ end) on the head commit, and become links to that commit. Paths hold no spaces, colons or backticks.
- **status** is derived from the data; don't set it.
- **Paste text** (`comment`, `reply`, `summaryComment`, a commit) is the exact text that goes into GitHub, in [comment style](comment-style.md): a ```` ```suggestion ```` block stays a literal fenced block. No emojis inside it, no severity prefix. Every paste box opens on its markdown rendered the way GitHub shows it (headings, lists, code, links, `<details>`, Mermaid), built as nodes so the text never becomes markup, with a **Raw** toggle for the exact text and **Copy**, which always copies the exact text.
- **Checks**, one row each, in this order: Build, Lint, Format, Tests (passed and failed counts, environment artifacts separated, failures that predate the PR named), CI recorded (run id and what the workflow actually gates), then any gate the repo's own docs require (typecheck, a server boot, a smoke script). A review adds Fan-out (compact or full, and why), Verification pass (candidates, from the conversation and the case against, to findings, questions, dropped), and Coverage (files on the checklist, reviewed, skipped with reasons, excluded as generated). A gate the repo does not define is `not-run` with "none configured". A row that describes rather than passes or fails (Fan-out, Verification pass, Coverage) is `info`.
- Nothing from the HOME (memory, feedback, private notes) goes into paste text. The rest of the page may cite it.

## Review

```yaml
verdict: approve | approve-with-fixes | needs-discussion | changes-requested | do-not-merge
risk: S | M | L | XL
riskWhy: what drove it, what it touches, tests added/changed/none, the triage counts
executed: where it has run (staging since a date, never, prod via #n); past 24 characters it shows as its own line, not a badge
sinceReview:                       # a re-review only
  prior: "10-09, head 1a2b3c4"
  sub: one line on who did what since
  findings: [{ id: the last review's id, title, status: fixed | changed | open | moot, anchor, now }]
  commits: [{ sha, subject }]
  conversation: [one line per thread or reply since]
description:
  picture: { title, text: text view }
  claims: [{ claim, code, anchor, status: matches | partly | wrong | missing }]
  proposed: paste text, the whole description the PR should merge with
lookAt: [{ anchor, why }]
skim: one line of counts
decisions: [{ decision, picks, anchor }]
asked: [{ criterion, status: met | not-met | untested, anchor }]
callTree: { title, text: text view }
explanation: two sentences, only when no call tree fits
flows: [{ title, diagram: Mermaid source, steps: [{ anchor, text }] }]
walkTree: { sub, text: text view }
behavior: [{ case, before, after, bad: true when the after is a defect, diff }]
holdQuestions: [two or three]
architecture:                      # large features only, see below
  sub: one line
  decision: the standing call this revisits, its cost and its benefit
  components: { title, diagram, caption }
  stats: [{ value, label, tone: ok | warn | bad | cool }]
  today: { title, diagram, caption }
  concerns: [{ concern, ok: true when it already sits where it should, state, today, anchor, recommended, reuses }]
  target: { title, diagram, caption }
  mapping: { title, sub, text: text view }
  comparisons: [{ title, sub, today: { title, text }, target: { title, text } }]
  debt: { adds: [], paysDown: [] }
  path: [{ step, what }]
caseAgainst: { strongest, threeMonths, cut }
findings: [{ id, priorId, pr, severity: blocker | fix-before-merge | nit | question, topic: tests | lint, title, anchor, lanes, principle, introduced,
             raisedBy: { who, url }, scenario: [3–5 steps], diagram, snippet, proof: [{ anchor | source, fact }], failure, evidence, comment }]
files: [{ path, class: risk | logic | mechanical, concern, summary, adds, dels, hunks: [{ lines, text }] }]
conversation: [{ who, kind: person | bot, url, anchor, point, state: open | partly | fixed | answered | unanswered | wrong | outdated, finding, note, reply }]
verifiedClean: [three to eight facts]
summaryComment: paste text
noticed: [{ anchor, text }]
dropped: [{ anchor, lanes, claim, reason }]
notChecked: [what was skipped and why]
```

- **sinceReview** is a re-review's opening: the last review's findings and questions, each re-checked at the new head (`fixed`, `changed`: the code moved but the problem moved with it, `open`, `moot`: the code is gone), the commits since its head, and the conversation since its date. The page and the card count fixed, changed, still open and new from these rows; nothing is counted by hand.
- **summary** is the whole report for a reader in a hurry (on a re-review, lead with the delta): two or three sentences with the verdict, the one thing that matters most, and what the author needs to do. A reader who stops there knows whether this merges.
- **risk** is a judgment: S is isolated with no auth, data or schema; XL is an auth or value path plus schema plus no tests. `riskWhy` says what drove it.
- Every anchor in `lookAt`, `decisions` and `findings` names a file in `files`. Unknown or misspelled keys are errors, so no section silently disappears.
- **lookAt** is where the operator's own attention goes: five hunks at most, `risk` files first, each with why it needs human judgment. A clean PR still names the hunk that carries its behavior. **skim** counts the mechanical bulk ("14 renames from the Order → Purchase move, 3 generated clients").
- **decisions** are only the choices someone could reasonably have made differently: a default, threshold, limit, timeout, retry count, error message, retention, who may do what. **asked** appears only when the linked issue or task states criteria.
- **The page order is the reading order:** understand the PR (the PR description, How it works, Architecture), judge it (Where to look, Since last review on a re-review, Findings, Questions, Case against), act on it (Review conversation, Summary comment), then reference (file map, verified clean, checks, noticed, dropped, not checked). The template owns the order; the data only decides which sections exist.
- **Diagrams can be opened full-window.** The template gives every drawn diagram an expand button with zoom and pan, so a large one (a lifecycle components map) can stay whole instead of being split to fit the column.
- **Show, don't narrate.** Every explanation picks the smallest view that carries the idea and sits beside the one line it supports: a **text view** (call tree, file tree, pseudocode), a 2–4 line diff or snippet, a scenario strip, or one Mermaid diagram. In a text view, two spaces then `# ` start a dim comment, and a line starting with `!` is drawn red (the line the finding is about). Keep a text view under about 15 lines and 70 characters wide. Prose is the fallback, never the default.
- **description** is the PR description section, and every review has one, because the merged description is the record people and agents read later. `picture` is the body's claims as one text view (what the author says it does, not what we found). `claims` has one row per claim the body makes, checked at the head: `matches`, `partly`, `wrong` (the code does something else), or `missing` (a change the body leaves out, its `claim` starting "(not in the body)"). `code` says what the head does in about twelve words, with the anchor. When any claim isn't `matches`, `proposed` is the whole replacement description, in the author's voice, accurate to the head: a two-sentence summary, a Mermaid diagram when the change is a flow (GitHub renders it), what's in and out of scope, deploy and rollback steps, and a verification section. It's paste text: no HOME paths, task ids or review findings.
- **How it works** is two screens at most and needs a `callTree`, an `explanation`, or a flow. Lead with the `callTree`: the entry point and the calls under it, a comment per line with the anchor or the why. Then one Mermaid diagram per flow, never one of everything: `sequenceDiagram` across processes, `stateDiagram-v2` for a lifecycle, `flowchart` for a data path, with processes and boundary crossings labelled; flow `steps` are twelve words at most. `walkTree` is the changed files as a shallow tree with one comment per folder or file, grouped by concern; when the PR should split, group it by the split so it doubles as the plan. `behavior` has one row per case whose behavior changed: `before` and `after` are fourteen words at most (leave `before` out when the case is new), `bad` marks an after that is a defect, and `diff` is two to four `+`/`-` lines where the change is control flow. A pure refactor is one row saying "No behavior change", and the lanes hold it to that. `holdQuestions` are conversation openers, not findings.
- **architecture** appears only when the PR adds a provider, an integration or a module, or changes about 1,500+ production lines across more than one app; the [architecture lane](dimensions.md) writes it. `components` is the feature by lifecycle stage (for a provider integration: account setup, request creation, routing, execution, settlement, webhooks, ops), top to bottom with each stage's parts left to right. `stats` are the measured footprint: files outside the feature's folder, provider or feature literals branching shared code, lines added to files already over the repo's size cap, copied steps. `today` and `target` are the same picture before and after, drawn in the same columns (shared callers, the platform seam, the feature's folder) so the difference is the middle column, with the feature's own code outlined. They draw the design's shape, not a map of folders: about ten nodes each, one node per role, no app or package boxes unless the boundary is the point. Make the columns with edges and node colours (a `classDef` per group, named in the caption), not subgraphs: Mermaid drops a subgraph's own direction once an edge crosses its border, and the layout collapses. `mapping` is a text view of the feature's current functions landing on the target interface's hooks, each line naming the finding or question the new shape removes, so the reader sees why the target is simpler, not just that it is. `comparisons` are today-and-target pairs of text views, usually two: the folder's file layout (today's listing beside the organized target, one comment per file or folder; the target groups the code by what it does: a few files at the top for what the platform sees, the client, constants and types, then folders named for behaviours, such as `checkout/`, `accounts/` or `refunds/`, with plain names inside and a test beside each module, never a flat folder of prefixed files; logic more than one app needs lives in the repo's shared package and the apps keep only wiring) and a code skeleton. Short-line pairs render side by side, code stacked. The code skeleton is the code itself at that altitude: today's shape (the shared files' branches on this provider and the feature's entry points, one comment line per elided body, `!` on the lines a finding is about) above the target's (the provider class on the team's real interfaces, modelled on a sibling provider that already uses them). Signatures, hooks and the few lines that carry a decision; no bodies. Keep it to the files whose shape changes, a class shown as its methods with `…` between them, and leave out wiring that is the same for every provider. Say which names are illustrative. `concerns` has one row per concern (send, poll, dispatch, selection, account requirements, webhooks, config): where it lives now, where it should, and the existing extension point it `reuses`, named by symbol. `debt` lists what the PR adds against what the recommended shape would pay down. `path` is the ordered PRs from here to the target, lined up with any split already agreed. When the recommendation reverses a call the operator already made, `decision` says so plainly, with its cost and its benefit, instead of overriding it quietly.
- **The findings list leads with signal.** The page shows, open, every blocker and every fix-before-merge that is new. Lower and collapsed, each under its own heading: a point someone already raised whose thread still stands (badged `replied`: the comment only adds to their thread), then findings about tests or lint (`topic`, badged like a nit), then nits. A reply that corrects a thread someone claimed fixed, or a point that doesn't hold, stays at the top, since that correction is signal. Questions split the same way. `topic` changes only where a finding sits, not its severity or the verdict. Ids follow the page order, so the script warns when they don't.
- The **proposed description** sits folded behind its toggle, so a long one doesn't push the review down.
- **findings** follow the playbook's rank, one anchor, one claim and one paste block each, and number from 1 in the order the page shows them (the signal, then already-raised, tests and lint, nits, then questions), so bot comments and the summary can point at them. A ```` ```suggestion ```` block replaces exactly the anchored lines, so the anchor covers every line it replaces. Every anchor names a file in `files`, and `lanes` lists every source that raised it (a merged finding names each): lane slugs from [dimensions](dimensions.md), `case-against`, `gate` for a local gate such as a failing linter, or `bot:<login>`. A blocker or fix-before-merge shows what goes wrong and the proof, as visuals: `scenario` is three to five steps of fourteen words at most, inputs first and the wrong outcome last (the page draws it red); `proof` is one line per fact, each with the `anchor` it was read at or the `source` (a partner doc, a sandbox run, a query) and the `fact` in fourteen words at most; `snippet` is two to four verbatim lines when the code itself is the point; `diagram` is one small Mermaid sequence only when timing across actors is the point. `failure` and `evidence` are the prose fallbacks. On a re-review, `priorId` is the id the last review gave a finding that is still open, so the delta counts it as carried, not new. In a stack, `pr` is the layer whose commit introduced the anchored code, the PR its comment is posted on; it is required when `stack` has more than one entry and must be one of its numbers. Everything in that finding (its anchor, proof anchors, snippet, and every line number in its title and comment) is read at that layer's `head`, since the comment lands on that layer's diff; the rest of the page reads the edge. A finding's anchor is a line GitHub lets you comment on, one inside that layer's diff: when the defect sits in unchanged code the layer makes reachable, anchor on the changed line that reaches it and name the unchanged lines in the comment. Nits are one entry per file, anchored to the file's path, with one comment listing them a line each. A `question` (verifier 40–74) is phrased as a question with what would settle it. With no findings, the list is empty and the page says so.
- **files** is every file on the coverage checklist with its triage class, grouped by concern (a schema field plus its writer plus its reader is one concern). The page shows each finding inside the file it anchors to, so nothing is listed twice in the data.
- **conversation** is every thread on the PR that makes a point or asks a question, people and bots in one list, each checked at the head: `open` (still holds), `partly`, `fixed`, `answered`, `unanswered` (a question to the author nobody answered; the page flags these first), `wrong` (doesn't hold), or `outdated`. `point` is about five words, `url` the comment's own link (`https://github.com/<repo>/pull/<n>#discussion_r…`, `issuecomment-…` or `pullrequestreview-…`), `note` what the head shows, `reply` a paste for that thread when one helps. **Never file a point someone already raised as new.** When a finding confirms a thread, the thread names its `finding` and the finding carries `raisedBy` with that thread's `url`: the page badges it "also raised by", and its `comment` becomes a reply on that thread that adds only what's new ("Still on <sha>: …"), never a restatement. A bot point that still holds must name its finding; a `wrong` thread needs the `note` and a `reply`. One paste per thread: a thread a finding replies on (its `raisedBy`) carries no `reply` of its own. In a stack the list covers every layer's threads, and each `url` stays on its own layer's PR.
- **A stacked page labels every reply with its PR.** When `stack` has more than one entry, each finding and each conversation row carries a `#<n>` badge (a thread's from its `url`), a filter row above Findings and Review conversation narrows both to one PR, and each paste header links straight to where it goes: the thread for a reply, the layer's Files tab at the anchored line for a new comment. A single-PR page shows none of this.
- **verifiedClean** is what was checked and found right, so the author knows what the review covered. Facts, not praise.
- **summaryComment** is an optional top-level comment under 120 words: the verdict, the blockers as a numbered list with anchors, what was verified clean, what did not run. For a stack, or any review with an `architecture` section, it is the PR-level overview instead, posted on the edge PR: the verdict in a line; the blockers and fix-before-merge as a short numbered list naming each PR; a link to each thread the operator already wrote on the stack (their own earlier comments, from `conversation` where they are the author), grouped by PR with where each stands (fixed, answered, still open); then, when there is an architecture section, the direction in two or three sentences, the `today` and `target` diagrams as Mermaid blocks (GitHub renders them), the target layout, and the code skeleton, from the same data the page shows.
- **noticed** is pre-existing defects seen along the way; they become tasks or follow-ups. **dropped** is every candidate under 40, so the operator can rescue one.
- Do not pad. A clean PR gets a short page with a real `verifiedClean`, not manufactured nits.

## Replies

```yaml
summary: the intro
sinceLast: [what changed since the report this one supersedes]
threads: [{ id, url, where: inline | conversation | review, anchor, reviewer, bot, outdated, pr, point, quote, status: to-post | follow-up | posted, reply }]
ownFindings: [{ title, anchor, detail, comment }]
commits: [{ subject, body }]
resolveOnly: [{ anchor, topic, why }]
stillOpen: [items]
```

- **sinceLast** appears on a re-run: the threads new, answered or fixed since the superseded report, one line each. The card shows it, so the next run reads it without opening the page.
- **summary**, one or two sentences: paste each reply on the thread it links to; what "done" means (the branch and sha the fixes sit on, or "in the working tree, not committed"); that outdated threads still get a reply so the record is complete. A re-run names the report it supersedes here.
- **threads** run in PR scroll order: inline threads in the file order `github_pr_view` lists `files`, then by line, then conversation comments, then review bodies. A stack reviewed together is one report: each thread carries its `pr`, bottom of the stack first.
- **The link is the point.** `id` is the fragment of the comment's own URL: `discussion_r1234567890` inline, `issuecomment-2345678901` in the conversation, `pullrequestreview-3456789012` for a review body. `url` is exactly `https://github.com/<repo>/pull/<n>#<id>`, with `<n>` the thread's `pr` in a stack. One click from the card to the box the reply goes in.
- **point** is the reviewer's point in about five words. **quote** is the comment's opening words exactly, so a Cmd-F on GitHub lands on the thread: trim only the end, with `…`, and never paraphrase inside it.
- **reply** is in the operator's voice, per [comment style](comment-style.md) → "Replies on your own PR"; its opening shows the verdict, so no verdict is written separately. It never says "will fix": the fix is in the working tree before the reply is written, or the reply says what blocks it.
- **status**: `to-post` is a reply still to paste; `posted` is a reply this tool drafted on an earlier run that the operator has since posted, and keeps its card with no reply ("Nothing new."); `follow-up` is a thread the operator already answered whose answer the code has since made false (on a first run too), with the update reply (comment style → "Your own earlier answer was wrong"). Any other thread whose answer still holds and that needs only the Resolve button goes in `resolveOnly`, not `threads`. The operator pastes only `to-post` and `follow-up`.
- **ownFindings** come from the self-pass: the defect in five words, its anchor, failure and evidence in two sentences then what changed, and an optional two-sentence `comment` to leave on the line so reviewers see it was found.
- **commits**, one per group of related fixes: a subject of 72 characters at most, and a body of two to five lines on why, naming the thread that asked for it. The operator commits.
- **resolveOnly** is threads that need only the Resolve click: `why` is "answered on <date>", "fixed in `<sha>`", or "reviewer confirmed".
- **stillOpen**: a claim needing a measurement that could not run, a fix belonging in another PR and why, a check that did not run, a thread whose answer needs someone else's decision.
- One report per PR, or per stack, per run; never leave overlapping drafts.
