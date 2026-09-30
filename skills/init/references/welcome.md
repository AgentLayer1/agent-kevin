# Welcome — the first session after init

Init can't ask what to do first: the operator has to exit and relaunch before the plugin, the identity files and the hooks take effect. So init leaves `"welcome": "pending"` in `<HOME>/.kevin/cadence.json`, and the SessionStart hook points here until the question has been answered. Ask it once, run the pick, and clear the flag.

`<PLUGIN_ROOT>` below is the plugin root the session context names.

## 1. Read the home (no writes)

- **Inbox:** how many files sit in `knowledge/raw/inbox/` (documents from init's Step 5d that no compile has absorbed yet).
- **Roadmap draft:** whether `knowledge/concepts/roadmap-draft.md` exists (the goals from Step 5d).
- **Roadmap:** whether `roadmap.html` exists at the home root (a seed bundle can bring one).
- **Packs:** whether `.claude/settings.json` grants any pack tool: `serpapi_search`, `web_search`, `browser_`, `database_`, `github_`, or `mcp__xcode__`. None means no pack was activated at init.

## 2. Greet and ask

One or two lines as the agent: setup is done, here is where we could start. Then one question, "Where should we start?", with `AskUserQuestion` under Claude Code or a numbered list under Codex. Offer up to four options, in this order, and skip any whose condition fails:

| Option | When | Runs |
|---|---|---|
| **Build your roadmap (Recommended)**: "from the goals you gave at setup" with a draft, "a plan-on-a-page for the year" without one | no `roadmap.html` | the `roadmap` skill |
| **Review your roadmap (Recommended)**: check the one you brought still holds | `roadmap.html` exists | the `roadmap` skill, as an update |
| **Absorb your documents**: read the N files you dropped in so I know them in full | inbox has files | the `knowledge-compile` skill |
| **Set up skill packs**: search, browser, GitHub, databases | no pack granted | the `configure-skills` skill |
| **Morning brief**: see what I already know and what's on today | always | the `briefing` skill, morning |

The roadmap row always comes first and always carries "(Recommended)". A typed answer ("Other") is a request of its own: do that instead.

## 3. Clear the flag

As soon as there is an answer, whatever it is:

```bash
bun "<PLUGIN_ROOT>/skills/sync/scripts/watermark.ts" welcome "<YYYY-MM-DD>"
```

Today's date in the home timezone. This turns `pending` into a date, and the next session opens normally. Never edit or delete `cadence.json` by hand; it also holds the goals cadences.

## 4. Run the pick

Invoke the chosen skill now (the Skill tool under Claude Code, `$name` under Codex) and follow it to the end. When it's done, close with one line naming the options not taken, as the commands that run them, so the operator knows they're still there.
