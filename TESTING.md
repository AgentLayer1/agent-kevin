# Testing skill changes on a throwaway home

Unit tests cover the MCP server and the scripts. They can't tell you whether a skill's prose makes a model do the right thing: whether the flywheel threads the right task, or whether sync asks the right question at the end. That needs a real session, run against a home that doesn't matter. This page is how to set one up so the operator's real home can't be touched.

Use it whenever a change to a skill, a hook, or the MCP server changes what a session *does*, and before calling that change verified.

## How isolation works

A session finds its home from `AGENT_HOME` (or the per-agent spelling such as `KEVIN_HOME`), else from the nearest folder above its working directory that holds `SOUL.md`. Hooks and MCP tools write only there. A few settings point outside the home, and each one is closed off:

| Path out of the fixture | What closes it |
|---|---|
| The home variable points at the real home | Launch with `AGENT_HOME` (and `<AGENT>_HOME`, if a settings file sets it) pointed at the fixture |
| Brain history in a separate git dir | `AGENT_HOME_GIT_DIR` is read from the home's own `.claude/settings.local.json`; the fixture's file doesn't set it. Unset it in the launch env anyway |
| Sync fast-forwarding real code repos | Unset `AGENT_GIT_REPOS` and `AGENT_CODE_PATH` (and their `<AGENT>_` spellings) for the launch |
| The installed plugin's hooks also running | Load the plugin only with `--plugin-dir`. Check the user-level `~/.claude/settings.json` `enabledPlugins` doesn't enable it globally |
| Outbound calls (web search, GitHub, Google) | Run sync as `sync only` (no briefing). Give the fixture no tokens unless the test needs them |

What still lands outside the fixture, and is harmless: the session transcript under `~/.claude/projects/<fixture-slug>/`, which a real home's session radar may list once, and model usage on the default login.

## Steps

1. **Check out the change** in a worktree (the `setup-worktree` skill), and install the server's dependencies there: `cd <worktree>/mcp-server && bun install`. A sandboxed agent session usually can't run `bun install` (bun's temp dir is blocked), so the operator runs it.
2. **Seed the fixture.** The demo seeder builds a fictional home (Acme's agent "Ace", operator Alex Chen) from the real templates, with dates relative to now, and makes it a git repo with one baseline commit. Run it from a checkout that has dependencies installed:

   ```
   bun <checkout>/skills/dashboard/scripts/demo-home.ts --out "$(mktemp -d "$TMPDIR/fixture-XXXXXX")/dashboard.html" --keep
   ```

   It prints `{ out, bytes, seed }`. The home is `<seed>/home/alex/agent-acme`.
3. **Remove the demo's own env.** The seed's `.claude/settings.local.json` and `.claude/settings.json` carry demo values (`KEVIN_HOME: ~/agent-acme`, `AGENT_CODE_PATH: ~/acme/platform`). Set the home variable to the fixture's absolute path and delete the code path, in the fixture only.
4. **Add the cases the change needs.** Write invented data only, never values from a real home. For each new behavior, add one case where it should fire and one where it shouldn't. Set file times with `touch -t` when a behavior depends on write order. Stage and commit the cases, new files included (`git -C <home> add -A && git -C <home> commit -m "test cases"`), check `git -C <home> status --short` is empty, and record that SHA as the baseline.
5. **Write the expectations down before running**, as a table: case → expected outcome → how to check it (a file, a frontmatter field, a question the session should ask).
6. **Launch the session.** The operator runs this, because an agent can't start an interactive session:

   ```
   cd <home> && env -u AGENT_GIT_REPOS -u AGENT_HOME_GIT_DIR -u AGENT_CODE_PATH AGENT_HOME=<home> claude --plugin-dir <worktree>
   ```

   Run the skills under test there, and answer any questions it asks the way the test plan says.
7. **Check from outside.** `git -C <home> status --short` and `git -C <home> diff <baseline>` show every file the run touched. Compare each against the expectations table. Anything changed that the table didn't predict is a finding too.
8. **Leave the fixture where it is.** It lives under `$TMPDIR`; never `rm` it by a built path.

## Gotchas

- **Shared scratch space.** `$TMPDIR` is per user, not per session. Always `mktemp`; never reuse a fixed fixture path another session might be writing.
- **Seeded sessions are short.** The demo's session logs are placeholders. A test of anything that reads sessions or daily summaries needs its own realistic case files.
- **The baseline commit is the oracle.** If sync's brain commit runs in the fixture (a local repo on `main` with no remote), it commits the run's changes. Diff against the recorded baseline SHA, not `HEAD`.
- **Codex.** The same fixture works for Codex in principle (launch `codex` from the home with the plugin enabled from the worktree), but that path hasn't been exercised yet. TODO(codex): verify and document the launch.
