# Recording the PR video

The ask is a video that shows the change being tested, across every path, not a feature tour. The runbook in the walkthrough report is the plan; this file holds the rules for building it and the mechanics for recording it.

## What counts as a path

Every branch the diff adds or changes is a path, and every path is a scene. Read the hunks, not the PR description:

| Signal in the diff | Paths it creates |
|---|---|
| A new endpoint or changed handler | the happy request · each validation failure the DTO or guard adds · each error the handler maps |
| A new `if` / guard / early return | the branch taken · the branch not taken |
| A new `switch` arm or enum value | that arm reached · the default still reached |
| A changed state transition | the row before · the trigger · the row after · the log line |
| A new or changed UI control | the click · the loading or disabled state · the success state · the error state |
| A schema change | the migration applied · one row in the new shape · the old reader still working if one remains |
| A shared-package change | one caller per distinct behavior, on camera through that caller |
| A deleted branch or write | the path that used to exist, shown no longer reachable, or the reader that now sees a different value |

**The comprehensiveness test:** scene count equals branch count, or the Gaps section says which branch is not demoed and what stands in for it (a spec by name, a log line, a database query). Never silently drop a branch.

## The observable

Each scene's `Expect` cell names something a viewer who does not know the codebase can see and check:

| Surface | Observable |
|---|---|
| Endpoint | status code, response body fields, a header; show the request too (the collection file or the curl) |
| UI | the rendered state; open the network tab for the call it fires when the point is the call |
| Background job | `database_query` before and after (local or staging), and the log line with its structured fields |
| Schema | `\d <table>` or the ORM's data browser row; the migration name in the terminal |
| Failure paths | the error the caller sees **and** the state left behind (a record still in its prior status, a row that did not change) |

"It works" and "correct response" are not observables.

## Getting to each path

In order of preference, name in the scene's `Setup`:

1. **The repo's own seed or fixture scripts.** Read the root `package.json` (or equivalent) and any `scripts/` or fixtures directory for a command that seeds the exact state (a user in a status, a record in a step); prefer it over hand-clicking there. Name the command and its flags. A command that spends money or targets production never runs from this skill; the operator runs it on camera if at all.
2. **A `browser-flows` flow** for UI paths that need a real login and a real UI.
3. **An `api-collections` request** for endpoint paths; the operator fires it from Bruno or curl on camera, which doubles as showing the request.
4. **A `database_query`** for the state before and after a background-job scene.
5. **Hand steps**, last, written as numbered clicks.

## Scene template

```
| # | Path | Setup | Action | Expect | Say | ⏱ |
| 3 | POST /orders · quantity over stock | `pnpm seed --case=over-stock` | fire `over-stock.bru` | 422 · `code: "OUT_OF_STOCK"` · row absent in `Order` | "Over stock: rejected before a row is written" | 25s |
```

- `Say` is one phrase, spoken while doing it, naming the path and the outcome. Not a narration of the code.
- `⏱` is honest: setup that runs on camera counts. Total lands in the runbook footer.
- Scenes run in the order a viewer would understand them: happy path first, then each guard, then failures, then the state check.

## Mechanics (macOS)

- **Capture:** `⌘⇧5`, record a selected window or region; or Loom if the team already watches Loom links. One take per scene; a cut between scenes beats a retake of the whole thing.
- **Layout:** browser at about 1280×800 on the left, terminal on the right with the font up two sizes. The walkthrough report sits on a second display or a Space the recording does not include. Nothing else on the captured screen.
- **Hygiene:** Focus mode on. Close every tab and pane showing a `.env`, an API key, a token, production customer data, or a production dashboard. Log out of production. If a surface would show something the repo's conventions keep internal, frame the shot to exclude it; the walkthrough's Prep list names such surfaces.
- **Open** with the PR title and number on screen for three seconds, then scene 1. Say the scene number as you start each one; the `--check` pass uses it.
- **Length:** three to six minutes. Longer means the scenes are narrating code instead of showing paths; cut the talking, keep the actions.
- **Audio:** built-in mic is fine. Say what you are about to do, do it, name what appeared. Silence during a wait is fine; do not fill it.

## Attaching to the PR

- Drag the `.mov` or `.mp4` into the PR description; GitHub renders it inline. If GitHub refuses the size, upload to Loom or Drive and paste the link.
- Add one line to the body, under the description: `Video: <link>, scenes 1–<n>: <three-word labels>`. The operator edits the body themselves; this skill never posts.
- If the PR changes after recording, either re-record the affected scenes or add `Video predates <sha>; scenes <k> unchanged` to the body. A stale video that no longer matches the diff is worse than none.

## After recording

`/pr-walkthrough <n> --check <path-to-video>` extracts scene-change frames, maps them onto the runbook, and reports covered / missing / unclear scenes plus anything on camera that should not be. Post only after the check says *post it*.
