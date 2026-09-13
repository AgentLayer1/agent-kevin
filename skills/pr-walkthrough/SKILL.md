---
name: pr-walkthrough
description: >
  Understand your own PR well enough to present it at standup and record the test video that
  goes with it. Author-side only: resolves your PR, rebuilds the change hunk by hunk from the
  diff, the task, and the sessions that wrote it, classifies every hunk by how hard it is to
  defend, verifies build/lint/tests locally, then writes one glanceable side-screen doc: a
  two-minute standup script, the diff tour in scroll order, the questions reviewers will ask with
  receipts, and a scene-by-scene recording runbook covering every path the change adds.
  Undefended hunks become gaps with an action, never a bluff. Optional interview rehearsal
  (`--rehearse`): the room's questions one screen at a time, with the misconceptions as
  distractors and every miss corrected against the code. `--check <video>` verifies a finished
  recording covered every scene. Writes `<HOME>/reports/reviews/`. Triggers on /pr-walkthrough,
  "help me present #531", "walk me through my PR", "prep my PR for standup", "quiz me on my
  PR".
disable-model-invocation: true
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write
  - Edit
  - Bash
  - Agent
  - AskUserQuestion
  - mcp__plugin_agent-kevin_kevin__github_pr_view
  - mcp__plugin_agent-kevin_kevin__github_pr_diff
  - mcp__plugin_agent-kevin_kevin__github_pr_comments
  - mcp__plugin_agent-kevin_kevin__github_pr_list
  - mcp__plugin_agent-kevin_kevin__github_run_list
  - mcp__plugin_agent-kevin_kevin__github_run_view
  - mcp__plugin_agent-kevin_kevin__github_issue_view
  - mcp__plugin_agent-kevin_kevin__github_fast_forward
  - mcp__plugin_agent-kevin_kevin__setup_worktree
  - mcp__plugin_agent-kevin_kevin__list_worktrees
  - mcp__plugin_agent-kevin_kevin__database_query
  - mcp__plugin_agent-kevin_kevin__video_frames
  - mcp__plugin_agent-kevin_kevin__report_write
---

> Operator-invoked only. Run this when the operator named this skill, or when a skill the operator invoked calls for it as a documented step; otherwise stop and ask before doing anything. Claude Code enforces this through the frontmatter above, Codex does not.

# PR Walkthrough

> **Paths.** Bare `apps/...`, `packages/...` references are repo-relative. The absolute repo path is `${KEVIN_CODE_PATH:-$AGENT_CODE_PATH}` (AGENTS.md → "Where Your Code Lives"); when the PR belongs to another configured repo, the operator names it or `--repo` does. Prefix it on every Read/Grep/Bash call. `<HOME>` is the directory the agent was launched from, never the code repo.

More teams now have the author walk the room through their PR at standup, and ship every PR with a video of the change being tested across its paths. Both are scrutiny surfaces. An author who generated half the diff and cannot say why a hunk exists loses the room for the whole approach, not just that hunk. This skill exists so the author walks in understanding the change to the line, holding a doc they can glance at on a hidden screen, and holding a recording plan that proves every path rather than the happy one.

It is author-side only. A teammate's PR is `pr-review`'s job; this skill is for the PR you are about to defend. It never posts anything. The GitHub pack is read-only by design.

## Banner

Every response begins with:

`🎤 PR walkthrough (your PR · read-only against GitHub · local worktree checks)`

Append `· --quick` / `· --no-local` / `· --check` when a flag changed what ran.

## Stance

- **The doc is a crutch for delivery, not for understanding.** Every answer in Questions must be one the author can give without the doc after a single rehearsal. Write it in the author's voice, as phrases they would say, not as a report about the PR.
- **Never bluff.** A hunk without a defensible reason is a 🔴 gap with a recommended action (simplify, revert, or ask), never a plausible-sounding paragraph. "I don't know yet, here is how I'll find out" survives scrutiny; a confident wrong does not, and it costs the whole team's credibility on generated code.
- **The video shows paths, not features.** Every guard, branch, and error arm the diff adds is a scene, or it is named in Gaps as not demoed and why.
- **Receipts over recall.** Each "say" line points at a file:line, a task, a PR number, a session note, or a measurement. The author's memory of why is the least reliable source for a diff a model helped write; the sessions that wrote it are the most reliable.
- **Cues, not sentences.** The author is on a shared screen, being questioned, glancing at a half-width pane. Twelve words a line, three table columns at most, no paragraphs. The doc is three lookups matched to where the room is pointing: the file on screen (Tour), the reviewer's own comment (Threads), the conceptual why (Questions), with a one-screen Cue card on top for the two minutes of talking.
- **Complete underneath, highlighted on top.** Every hunk gets a line, so the author can say "I read all of it". At most five ★ mark where the room will actually look, so the important places are not buried by the complete list.
- **Reviewers start from their own comments.** Every review thread, resolved or not, bot or human, gets an entry with its state and the line to say. A fix that is on the branch but not replied to is still a gap: the reviewer will re-raise it.
- **Reuse `pr-review`'s foundation.** Steps 0 to 3 below run `../pr-review/SKILL.md`'s Steps 0 to 3 as written, with the additions named here. Do not reimplement them and do not skip them.

## Step 0 — Resolve the target

Run `pr-review` Step 0 as written (argument parsing, `github_pr_view`, the stacked-PR and closed-PR rules). Then:

- **Require the PR to be the operator's.** Compare `author.login` to the `GitHub login:` line in `<HOME>/USER.md`. When it is a teammate's PR, stop and say so in one line, offering `/pr-review <n>` instead. When the login line is missing or still the placeholder, ask once with `AskUserQuestion` and fill it in.
- **Flags** (combine freely; `--check` runs alone):

| Flag | Effect |
|---|---|
| `--standup` | Sections 1 to 4, 6, 7 only: no recording runbook |
| `--record` | Sections 1, 5, 6, 7 only: no standup script or diff tour |
| `--check <video>` | Post-record verification against the existing walkthrough report for this PR; needs no other step |
| `--rehearse [top\|threads\|all]` | Run the Step 6 interview against the existing walkthrough report for this PR, without regenerating it (default `top`) |
| `--quick` | No worktree, no local checks, no session grep. The report says so and is saved as `draft` |
| `--no-local` | Full analysis but skip the worktree build/lint/test |
| `--repo owner/name` | Override the repo derived from the code path |

Stacked PR: walk this layer only, name the parent PR in the pitch.

## Step 1 — Prior context

Run `pr-review` Step 1 as written (prior reports, tasks, concept articles, the repo's conventions). Then add the two sources a walkthrough needs and a review does not:

1. **Every review thread**, from `github_pr_comments` (`reviewThreads`, `reviews` with a body, `comments`), plus any prior review or replies report on this PR (`<HOME>/reports/reviews/*pr-<n>*`). Each thread becomes a **Threads** entry in conversation order: reviewer, anchor, state (✅ fixed and replied · 🟡 fixed, reply not posted · 🔴 open · ✔ resolved), what they said in twelve words, what to say in fifteen with a receipt. Judge the state against the head code, not the reply: a reply that says "fixed" for a commit that is not on the branch is 🔴. Open and 🟡 threads also seed **Questions** and, when the fix or reply is missing, **Gaps**.
2. **The sessions that built the PR.** `Grep` `<HOME>/knowledge/raw/sessions/` for the PR number and `headRefName`, then read the matching blocks. This is where the *why* lives for generated code: the rejected alternatives, the measurement that picked a constant, the reviewer comment that forced a shape. Skipped under `--quick`, and the report says so, because it is the source most likely to rescue a 🔴 into a 🟢.

Surface a short **Prior context** block in the first response, then continue.

## Step 2 — Understand to the hunk

Run `pr-review` Step 2 as written: pull the diff, group by concern, build the what / why / how / blast-radius model, draw the ASCII diagram. Then the pass that makes this a walkthrough:

**Every hunk gets one line and a class.** Walk the diff file by file in the order GitHub's Files tab shows them (alphabetical by path, which is the order the author will scroll on the shared screen). For each hunk write a cue (what it does, eight words) and an "if pressed" line (why it is here, fifteen words, with the receipt), then classify:

| Class | Meaning | Examples |
|---|---|---|
| 🟢 obvious | A reader sees the reason from the code alone | rename, import, the test that pins the fix, the DTO field the feature needs |
| 🟡 needs a reason | Correct, but the room will ask why | a constant's value, an ordering, a new helper, a file touched by the change's ripple |
| 🔴 needs a defense | A reviewer will challenge it, and the code alone does not justify it | new dependency, deviation from the file's neighbors, deleted code, changed error handling, anything on an authorization, money, or data-integrity path, a file touched with no visible link to the change, a `TODO`, a suppressed lint |

For every 🟡 and 🔴, find the receipt: the task, the session note, the concept article, the `git blame` of the neighboring line that set the pattern, the spec that pins it, the measurement. A 🔴 with a receipt stays 🔴 in the tour (so the author knows to lead with the receipt) but is not a gap. A 🔴 **without** a receipt is a gap, and the Gaps section carries a recommended action:

- **Simplify**: the hunk does more than the PR needs (speculative flexibility, a second constant, an abstraction with one caller). Say what the minimal form is.
- **Revert**: the hunk is unrelated to the PR's purpose. Name it; unrelated hunks are a defect even when builds pass.
- **Ask**: the hunk may be right but the reason lives with someone else (a reviewer's suggestion, an external constraint). Name who.
- **Describe**: the code is right but the PR title, body, or an unanswered thread says otherwise. The room reads the body before the diff, so a stale body is a gap even with a perfect diff. Name the sentence to change or the thread to answer.

Do not soften a gap into a 🟡 because the author would prefer it. The gap list is the part of this doc that saves the author at standup.

**Then pick the ★.** At most five files (or hunks inside a large file) where the room will look: the 🔴 hunks, the anchor of any open thread, the entry point. Everything else stays in the Tour as one line, unstarred.

**Blast radius, for the room's benefit.** Note every caller of a changed exported symbol and every reader of a changed field, in one line each, so "who else does this touch?" has an answer with a count.

## Step 3 — Local verification (skip only with `--quick` or `--no-local`)

Run `pr-review` Step 3 as written, in **reply-mode shape**: this is your branch, so `setup_worktree({ repoPath, branch: "<headRefName>" })` checks it out (reuse an existing worktree if `list_worktrees` shows one). Build, lint, format, and the changed packages' tests, each with an absolute `cd` and `pipefail`. Record every result for the Evidence section. This is what turns "tests pass" from a hope into a fact the author can state in the room.

Also record what CI shows via `github_run_list` / `github_run_view`, labeled "what CI recorded", never as a verdict: read the workflow that produced the check, because a step marked `continue-on-error` or a job skipped on the PR event makes green a claim rather than a fact.

## Step 4 — Enumerate the demo paths (skip under `--standup`)

Read `references/recording.md` first. From the hunk model, list every **observable path** the PR adds or changes, by surface:

| Surface | Signal in the diff | The observable on camera |
|---|---|---|
| Endpoint | controller, route, DTO, guard, middleware | the request and the response body, status code, and any header |
| UI | components, pages, hooks | the click, the rendered state, the network call it fires |
| Background job | worker, processor, scheduled task, state transition | the row before and after (`database_query` against local or staging), and the log line |
| Schema | the schema file, a migration | the migration applied, one row showing the new shape |
| Shared package | a `packages/*` change with several callers | one caller per distinct behavior, not the package in isolation |

For each path list its **branches**: the happy case, every new or changed guard, every error arm, the edge the tests pin. Each branch is a scene. Then name how to reach it:

- The repo's own seed or fixture scripts (read the root `package.json` or equivalent, and any `scripts/` or fixtures directory) that put the system in the exact state. Name the command and its flags in the scene's *setup*. Nothing that spends money or targets production runs from this skill; the operator runs it on camera.
- A `browser-flows` flow for UI paths, an `api-collections` request for endpoint paths, a `database_query` for state.

A branch with no practical way to reach it on camera is still listed, marked *not demoed*, with the reason and what stands in for it (a spec name, a log line). The comprehensiveness test is simple: the scene count equals the branch count, or Gaps says why not.

## Step 5 — Write the report

Use `templates/walkthrough.md`. Fixed section order, fixed legend. Read `references/questions.md` before writing the Cue card and Questions; the catalogue there is what the room actually asks, the **Provenance** group decides whether generated code is trusted, and the "If lost" and "Don't say" lists are what keep a hard question from becoming a bad moment.

Constraints the template states and this step enforces:

- **Cues, not sentences.** Twelve words a line. Cut until each line can be taken in without reading. The receipt carries the depth.
- **Three columns at most, and only where a table beats a list.** The pane is half-width; wide tables wrap into noise. Threads, Tour, Questions, and Scenes are lists with a fixed micro-format.
- **The Cue card fits one screen** and is the whole doc for the two minutes of talking. If it scrolls, cut it.
- **Complete underneath.** Every hunk has a Tour line; every thread has a Threads entry. ★ (five at most) carries the emphasis, never omission.
- **Scroll order everywhere.** Tour numbers follow the Files tab, Threads follow the Conversation tab, scene numbers are said out loud while recording.

Save with `report_write`:

```
report_write({
  category: 'reviews',
  slug: 'pr-<n>-walkthrough',
  title: 'PR #<n> walkthrough: <pitch in one clause>',
  skill: 'pr-walkthrough',
  status: 'findings' | 'clean' | 'draft',
  body: <the report, no frontmatter>,
  tags: ['pr-<n>', 'walkthrough', '<domain>', ...],
  extra: { pr: <n>, head: '<sha>', base: '<branch>', sections: ['standup', 'record'],
           gaps: <count>, scenes: <count>, runtimeMinutes: <estimate>,
           supersedes: '<relPath of the prior walkthrough or null>' }
});
```

`findings` when any 🔴 gap exists; `clean` when none; `draft` under `--quick`. A re-run on the same PR supersedes the prior walkthrough and says what changed (new hunks, closed gaps). If a ```mermaid block was used instead of ASCII, run the mermaid skill's Tier 1 check on the saved path and fix it in place.

## Step 6 — Rehearse (optional interview)

Rehearsal is where the doc stops being a crutch: an author who has answered a question once, and been corrected once, does not have to find the line under pressure. It runs as an `AskUserQuestion` interview, one question per screen, so it feels like the room and not like reading. Read `references/rehearsal.md` before the first question; it holds the distractor and grading rules.

**Offer it after every report** with one `AskUserQuestion` (header `Rehearse`): *Rehearse before standup?* · **Top 5 (Recommended)**: the Cue card's three plus provenance plus the newest open thread, about three minutes · **Threads only**: one per 🔴/🟡 thread, the reviewer's own words · **Everything**: every Questions entry · **Not now**. It is also reachable on its own against the saved report: `/pr-walkthrough <n> --rehearse [top|threads|all]`.

**Each question is one `AskUserQuestion`:**

- Header `Q k/N`. The question text is phrased as the room would say it, prefixed with who is likely to ask (the reviewer's name from the thread, the lead's, `Bugbot said:`), so the author rehearses the voice too.
- Three or four options: one right (the doc's answer, reworded so it is not recognisable as a copy), the rest distractors built per `references/rehearsal.md`: the stale claim, the reviewer's original suggestion, the pre-PR behavior, the answer that sounds right and is not. Shuffle; the right one is never reliably first or longest.
- The built-in *Other* is "answer in my own words", and is the better rehearsal: grade a typed answer on whether its claims match the code, never on wording.

**After each answer, two lines at most** in chat: `✅ right` · `🟡 right, lead with <receipt>` · `❌ <why that answer is what the room believes> <the correct line> <file:line>`. Then the next question. A distractor picked is not a failure; it is the exact misconception the room holds, and the correction is the prep.

**Close the set.** Re-ask every missed question once, in plain chat with no options (recall, not recognition). Then one scoreboard line: `<n>/<N> first try · <k> re-asked · <j> still missed`. Anything still missed is appended to the saved report's Gaps section in place (`Edit` on the report path) under **Answer from memory**, as the question, the right line, and its receipt, so the doc names what still needs drilling before the room does.

## `--check <video>` mode

Runs alone. Needs an existing walkthrough report for this PR; if none, say so and stop.

1. `video_frames({ video: <path>, mode: 'scene' })`, then `Read` every returned frame.
2. Map frames to the report's scenes table by what is on screen: the URL, the UI state, the terminal command, the response. One frame can cover a scene; a scene with no frame is *missing*; a frame that matches no scene is *unplanned*.
3. Scan every frame for what must not be on camera: API keys, tokens, `.env` contents, production customer data, and anything from the HOME (memory, feedback, private notes) that drifted onto the captured screen. Any hit is a 🔴 with the timestamp.
4. Append `## 🎬 Recording check` to the saved report (`Edit`, in place) with a table: `#` · scene · `✅ covered @t` / `❌ missing` / `❓ unclear` · note, then the unplanned frames, then the on-camera hits, then the verdict: *post it* / *re-record scenes N, M* / *cut before t=…*.

Report the verdict line and the path in chat. Nothing else.

## Step 7 — Hand back

In chat, after the report is saved: the banner, the pitch line, the gap count with the first gap named, the scene count with the runtime estimate, and the report path. Then the Step 6 rehearse offer as its `AskUserQuestion`. Do not repeat the report.

If the operator later says a question landed differently at standup, or a scene did not prove what it claimed, that goes to `knowledge/raw/user/feedback.md` the same session.

## Boundaries

- Never posts to GitHub or any chat or tracker surface. Never edits the PR body. The operator attaches the video and pastes the one-line body addition themselves.
- Never commits or pushes. A gap's recommended action is a recommendation; the operator applies it.
- Never runs a command that spends money or targets production. The scene names it; the operator runs it on camera.
- No PII or secrets in the report. IDs and counts only. Database evidence comes through `database_query` and is quoted as counts and IDs.
- The report may cite HOME material (it stays in HOME); the body line and the video may not, and the runbook's Prep list names any screen where it would show so the author frames the shot around it.
