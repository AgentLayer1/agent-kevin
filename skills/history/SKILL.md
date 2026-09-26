---
name: history
description: Turn on version history for the agent's memory, so any change to what it knows can be seen and undone. Stays on this computer, nothing is uploaded; a cloud-synced home (iCloud, Dropbox, OneDrive) keeps its history in a local folder instead. Fully managed, no git knowledge needed. Use when the operator says "turn on history", "keep a history of my agent", "can I undo changes to your memory", or the upgrade or init flow points here.
allowed-tools: AskUserQuestion, Read, mcp__plugin_agent-kevin_kevin__home_history, mcp__plugin_agent-kevin_kevin__codex_setup
---

# History

Version history for the agent home, for someone who has never heard of git. The `home_history`
tool does every step outside the shell sandbox; this skill owns the conversation.

**Words.** Say *history*, *snapshot*, *saved version*, *folder*. Never say repo, repository,
gitdir, worktree, commit, branch or pointer to the operator, including in errors you relay. Use
the agent's display name where these steps say `<Agent>`.

## 1. Read where things stand

Call `home_history` with `action: "status"`. It puts back a `.git` link a synced folder deleted;
when it returns `restored: true`, say "<Agent>'s history link went missing and is back." once.
Then branch on `state`:

| `state` | Do |
|---|---|
| `off` | Step 2 |
| `on`, `lastCommit` null | A setup that stopped early: step 3 with no questions |
| `on`, `homeSyncedBy` set | The folder started syncing after history was turned on, so the history sits where syncing can damage it. Ask with `AskUserQuestion`: "<Agent>'s folder now syncs to `<homeSyncedBy>`, which can damage its history. Move the history to `<historyFolder>`, on this computer?" with "Move it (Recommended)" / "Not now". Yes runs step 3 |
| `on` | When `codexWired` is true and `layout` is `"split"`, call `codex_setup` first (it changes nothing when Codex is already set). Then: "History is on, kept in `<gitDir>`. Last saved `<lastCommit.date>`." Stop |
| `managed-by-you` | "This folder already has version history set up some other way, so <Agent> leaves it alone." Stop |
| `git-missing` | History needs git, a free tool. Relay the install step from `message`: on a Mac it is a command to run in this chat as `! xcode-select --install`, elsewhere a download link. Then: "Ask me again once it's installed." Stop |
| `history-missing` | Ask with `AskUserQuestion`: "The saved history this folder pointed to isn't available (it was deleted, it's on another computer, or it belongs to the folder this one was copied from). Start a new history here?" with "Start a new one (Recommended)" / "Not now". Mention once that if this folder is also used on another computer, its history there is separate. Yes runs step 3 with `startOver: true`, and step 4 names the new folder |

## 2. Offer it (one question)

`AskUserQuestion`, header "History":

> **Turn on history for <Agent>'s memory?** Every change to what <Agent> knows gets saved, so it
> can be seen and undone. It stays on this computer; nothing is uploaded.
> - **Turn it on (Recommended)**
> - **Not now**

When `homeSyncedBy` is set, add to the question: *"Your files sync to `<homeSyncedBy>`, so the
history is kept on this computer instead, in `<historyFolder>`, where syncing can't damage it."*

## 3. Set it up

Call `home_history` with `action: "setup"` and `name` set to the operator's
name from `USER.md` (used only when this computer has never been told who's saving). Branch on
`outcome`:

- **`turned-on`, `already-on`, `moved`**: step 4.
- **`refused`**: relay `message` in plain words and stop. When it names private files that would
  enter history, say they are kept out on purpose and that this folder's ignore list lets them in;
  nothing was saved.
- **`failed`**: relay `message` in plain words and stop. Don't say nothing changed: setup may
  already have created the history folder. Running it again usually picks up where it stopped; if
  the same message comes back, it needs that problem fixed first.

## 4. Confirm

When `codexWired` is true and `status.layout` is `"split"`, call `codex_setup` so Codex can write to
the history folder too. It changes nothing when Codex is already set, so calling it again is harmless.

Close with one line:

> History is on. <Agent> saves a snapshot every time you run sync. It stays on this computer,
> in `<status.gitDir>`, and your computer's own backup (Time Machine on a Mac) covers it.

For `moved`, say the history now lives in `<status.gitDir>`, on this computer. For `already-on` after
a restored link, say what was fixed in one line instead.
