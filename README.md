<div align="center">

<img src="assets/kevin-avatar.jpg" alt="Kevin" width="180" />

# Agent Kevin 🍌

**Your personal AI assistant, as a Claude Code or Codex plugin.**
One markdown folder, one plugin, a brain that learns who you are session after session.

<p>
  <a href="https://dev.agentlayer.one/docs"><img src="https://img.shields.io/badge/Docs-dev.agentlayer.one-5EFFA1.svg" alt="Documentation"/></a>&nbsp;
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License"/></a>&nbsp;
  <a href="https://docs.claude.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-plugin-orange.svg" alt="Claude Code plugin"/></a>&nbsp;
  <a href="https://developers.openai.com/codex"><img src="https://img.shields.io/badge/Codex-plugin-black.svg" alt="Codex plugin"/></a>&nbsp;
  <a href="https://dev.agentlayer.one/docs/about/platforms"><img src="https://img.shields.io/badge/macOS-tested-success.svg" alt="macOS tested"/></a>&nbsp;
  <a href="https://agentlayer.one"><img src="https://img.shields.io/badge/Made_by-AgentLayer-blueviolet.svg" alt="Made by AgentLayer"/></a>
</p>

**[Read the docs →](https://dev.agentlayer.one/docs)**

</div>

---

## What is Kevin?

Kevin is a portable, file-based personal AI assistant that plugs into the agent CLI you already use, [Claude Code](https://docs.claude.com/en/docs/claude-code) or [OpenAI Codex](https://developers.openai.com/codex). Everything that makes Kevin *Kevin* (personality, memory, knowledge, projects, tasks) lives in your own directory as plain markdown. Any AI can read it. You can browse it in Obsidian or Finder. If you ever want to leave, you take the folder and go.

It is not a chat wrapper. It is an operating system for personal AI:

- A **56-tool MCP server** for tasks, knowledge compilation, reports, worktrees, database queries, GitHub review, search, page speed, a bundled browser, and Google Search Console.
- A **38-skill library** covering onboarding, project lifecycle, daily / weekly / monthly cadences, trip planning, worktree setup, API-request drafting, and read-only SEO auditing.
- A **knowledge pipeline** that turns every conversation into structured, queryable memory.
- **Opt-in packs** (SEO, Browser, Database, GitHub, API) and a bridge to community skill libraries via [skills.sh](https://skills.sh).
- **You drive.** Every bundled skill waits for you to invoke it; Kevin acts when you ask, never on its own.

```mermaid
graph LR
    A[Sessions] -->|capture| B[Knowledge]
    B -->|informs| C[Projects]
    C -->|generate| D[Results]
    D -->|feed back into| A
```

Every session is captured on exit. Captured sessions compile into a wiki. The wiki loads before you type a word in the next session. That loop is the whole product.

> *Kevin is named after the loyal minion. Helpful, enthusiastic, a little nerdy.*

---

## Quick start

You need **Bun ≥ 1.1**, **Git**, and a host: **Claude Code** or **Codex**. Full prerequisites, the local clone install, and Windows notes are in [Install](https://dev.agentlayer.one/docs/getting-started/install).

Pick a home for the brain, then install the plugin from it:

```bash
mkdir -p ~/Documents/Agents/Kevin && cd ~/Documents/Agents/Kevin
```

| Claude Code | Codex |
|---|---|
| `claude`, then `/plugin marketplace add github:AgentLayer1/agentlayer-agent-marketplace` and `/plugin install agent-kevin@agentlayer` | `codex plugin marketplace add AgentLayer1/agentlayer-agent-marketplace` then `codex plugin add agent-kevin@agentlayer` |
| Relaunch and run `/agent-kevin:init` | Create the home from Claude Code, then open it with `codex` and run `$upgrade` once |
| Skills: `/agent-kevin:<skill>` | Skills: `$<skill>` |

Five minutes of questions later you have a home. See [Onboarding](https://dev.agentlayer.one/docs/getting-started/onboarding) and [Hosts](https://dev.agentlayer.one/docs/hosts).

**Want a head start?** The [wizard](https://dev.agentlayer.one/#wizard) turns eleven prompts about your company into a seed bundle; hand the zip to `init` and the agent wakes up named, characterised, and briefed. A teammate's `seed-export` does the same from an existing agent. → [Seed bundles](https://dev.agentlayer.one/docs/usage/seed-bundles)

**Always launch from the agent home.** The plugin loads only for sessions started there, and that is also what keeps several agents on one machine apart. Reach your code through `permissions.additionalDirectories`, not by launching from a repo.

---

## Documentation

This README is the short version. Everything lives at **[dev.agentlayer.one/docs](https://dev.agentlayer.one/docs)**, also served as [llms-full.txt](https://dev.agentlayer.one/llms-full.txt) for models.

| Section | Start with |
|---|---|
| [Getting started](https://dev.agentlayer.one/docs/getting-started/install) | Install · Onboarding · Your first session · Updating |
| [Concepts](https://dev.agentlayer.one/docs/concepts/agent-home) | The agent home · The brain · Tasks · Sync · Self-evolution · Architecture |
| [Hosts](https://dev.agentlayer.one/docs/hosts) | What a host provides · Claude Code · Codex |
| [Usage](https://dev.agentlayer.one/docs/usage/daily-rhythm) | Daily rhythm · Capture · Dashboard · Multiple agents · Seed bundles · Worktrees · Browser · SEO |
| [Reference](https://dev.agentlayer.one/docs/reference/skills) | Skills · MCP tools · Hooks · CLI · Configuration · Accounts · Upgrades · Naming |
| [Workstation](https://dev.agentlayer.one/docs/workstation) | The rig: Ghostty · cmux · editor and tools |
| [About](https://dev.agentlayer.one/docs/about/privacy) | Privacy · Platforms · FAQ · History · Contributing |

---

## Highlights

<div align="center">
<img src="assets/dashboard.png" alt="Kevin Agent OS dashboard" width="720" />
</div>

- **Memory that compounds.** Hooks capture every session; the `knowledge-compile` skill distils them into user facets, concept articles, and active memory that load next launch. → [The brain](https://dev.agentlayer.one/docs/concepts/the-brain)
- **Projects, not just chats.** One markdown file per task with frontmatter, threads, and a generated dashboard. → [Tasks](https://dev.agentlayer.one/docs/concepts/tasks)
- **One pass to bring everything current.** The `sync` skill runs compile → lint → flywheel → dashboards and ends with a next move. → [Sync](https://dev.agentlayer.one/docs/concepts/sync)
- **A mission-control page** regenerated on every sync, self-contained, zero external requests. → [Dashboard](https://dev.agentlayer.one/docs/usage/dashboard)
- **Multiple homes, multiple personas.** One plugin install, separate brains, told apart by the launch folder. → [Multiple agents](https://dev.agentlayer.one/docs/usage/multiple-agents)
- **Hand an agent to a teammate.** A seed bundle carries persona, curated knowledge, and setup with fork semantics; credentials travel as names only. → [Seed bundles](https://dev.agentlayer.one/docs/usage/seed-bundles)
- **Subscription-billed.** The MCP server returns prompts; your session does the thinking on your host's plan. → [Hosts](https://dev.agentlayer.one/docs/hosts#billing)
- **Private by construction.** Secrets in a deny-gated store Kevin cannot read, transcripts redacted before they persist. → [Privacy](https://dev.agentlayer.one/docs/about/privacy)

---

## Updating

Pull the new plugin version on your host (`/plugin update agent-kevin@agentlayer` in Claude Code; remove and re-add in Codex), then run the `upgrade` skill. The plugin update refreshes code; `upgrade` reconciles your home from the CHANGELOG's Upgrade blocks, backing up first. → [Updating](https://dev.agentlayer.one/docs/getting-started/updating) · [Upgrades and releases](https://dev.agentlayer.one/docs/reference/upgrades)

---

## Contributing

Pull requests welcome: new opt-in packs, read-mostly MCP tools, platform hardening, docs. Open an issue first for architectural changes; Kevin's contract with the markdown home is intentional. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Licensed under the [Apache License, Version 2.0](./LICENSE). `agent-kevin` is © AgentLayer · [agentlayer.one](https://agentlayer.one). See [NOTICE](./NOTICE) for the attribution stanza. Third-party skill libraries installed via the `configure-skills` skill are not bundled and carry their own licenses.

---

<div align="center">

<a href="https://agentlayer.one"><img src="assets/agentlayer-logo.png" alt="AgentLayer" height="40" /></a>

**Built by [AgentLayer](https://agentlayer.one)** · *agentic infrastructure for AI-native operations*

</div>
