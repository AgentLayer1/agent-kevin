#!/usr/bin/env bun
/**
 * Seeds a fictional agent home (Acme's agent "Ace", operator Alex Chen) from the real templates,
 * renders the Agent OS dashboard from it in isolation, and writes a publishable demo page with every
 * temp and machine path rewritten. Dates are relative to now, so the demo always reads as current.
 *
 * Usage: demo-home.ts --out <dashboard.html> [--avatar <ace-avatar.jpg>] [--keep]
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined =>
  args.indexOf(name) === -1 ? undefined : args[args.indexOf(name) + 1];
if (process.platform === 'win32') {
  // TODO(windows): the render runs behind a POSIX sh shim on a ':'-joined PATH.
  console.error('demo-home.ts runs on macOS or Linux; render the demo from there.');
  process.exit(2);
}
const outArg = flag('--out');
if (!outArg) {
  console.error('usage: demo-home.ts --out <dashboard.html> [--avatar <jpg>] [--keep]');
  process.exit(2);
}
const OUT = resolve(outArg);
const AVATAR = flag('--avatar');
const REPO = resolve(import.meta.dir, '..', '..', '..');
const TZ = 'America/New_York';
const PUBLIC_HOME = '/home/alex';
const PUBLIC_PLUGIN = '/home/alex/.claude/plugins/marketplaces/agentlayer';

const ROOT = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'demo-dashboard-'));
const FAKE_HOME = join(ROOT, 'home', 'alex');
const HOME_DIR = join(FAKE_HOME, 'agent-acme');

const DAY_MS = 86_400_000;
const now = new Date();
const dateOf = (date: Date): string => date.toLocaleDateString('sv-SE', { timeZone: TZ });
const clockOf = (date: Date): string =>
  date.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const offsetOf = (date: Date): string =>
  new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')
    ?.value.replace('GMT', '') || '+00:00';
const isoOf = (date: Date): string => `${dateOf(date)}T${clockOf(date)}:00${offsetOf(date)}`;
const day = (offset: number): string => dateOf(new Date(now.getTime() + offset * DAY_MS));
const minutesAgo = (minutes: number): Date => new Date(now.getTime() - minutes * 60_000);
const atYesterday = (clock: string): Date => {
  const [hours, minutes] = clock.split(':').map((part) => parseInt(part, 10));
  const today = minutesAgo(0);
  const localNow = parseInt(clockOf(today).slice(0, 2), 10) * 60 + parseInt(clockOf(today).slice(3), 10);
  return new Date(today.getTime() - (localNow + 24 * 60 - (hours * 60 + minutes)) * 60_000);
};

const write = (rel: string, content: string): void => {
  const path = join(HOME_DIR, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content.startsWith('\n') ? content.slice(1) : content);
};
const writeAt = (root: string, rel: string, content: string): void => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
};

const plugin = JSON.parse(readFileSync(join(REPO, '.claude-plugin', 'plugin.json'), 'utf-8'));
const renderTemplate = (name: string, values: Record<string, string>): string =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{{${key}}}`, value),
    readFileSync(join(REPO, 'templates', name), 'utf-8')
  );

// Identity stack. SOUL and IDENTITY are Acme's own; the manual and bridge come from the real templates.
write(
  'AGENTS.md',
  renderTemplate('AGENTS.md', {
    AGENT_NAME: 'Ace',
    KNOWLEDGE_REL: 'knowledge',
    PROJECTS_REL: 'projects',
    PLATFORM: 'macOS',
    SHELL: 'zsh, Homebrew at `/opt/homebrew`'
  })
);
write(
  '.claude/CLAUDE.md',
  renderTemplate('CLAUDE.md', { AGENT_NAME: 'Ace', KNOWLEDGE_IMPORT: '../knowledge', PROJECTS_IMPORT: '../projects' })
);
write(
  'IDENTITY.md',
  `
# Identity

${AVATAR ? '![Ace](assets/ace-avatar.jpg)\n' : ''}
## Who

- **Name:** Ace
- **Kind:** Company agent (agent-acme, forked from agent-kevin)
- **Vibe:** Sharp but approachable. Gets things done. Knows the codebase and the company.
- **Emoji:** 🤖

## Short Bio

Ace is Acme's private company agent. It pairs with engineering on real tickets, compiles the company's knowledge into a living brain, and briefs leadership every morning. Self-hosted on Acme infrastructure; nothing leaves the building.

## Core Role

- Agentic engineering: coding, debugging, monitoring, and planning with full company context.
- Company brain: capture, compile, and serve institutional knowledge.
- Daily briefings, task tracking, and incident support.

## Operational Pattern

- **Briefings.** The morning brief carries priorities plus signal-topic and industry news; the evening wrap is a today-only delta.
- **Code.** The engineer skill for platform work, pr-review for teammates' PRs.
- **Review loop.** Ace implements; a second model reviews on one dossier, and Ace verifies every finding against the code.
`
);
write(
  'SOUL.md',
  `
# Soul

## Vibe

You are Ace, Acme's company agent. Sharp, direct, allergic to fluff. You ship with the engineering team daily and brief the leadership floor every morning. Clever over polite; useful over impressive.

## Writing Style

- Lead with the number. Tables and before/after blocks over paragraphs.
- ASCII diagrams in chat; Mermaid in files.

## Core Truths

- **Do the thing.** Explain after, not before.
- **Verify before you claim.** A number gets a source or it stays out.
- **Have a spine.** Recommend once, then build to the call.
- **Figure it out.** Read the file, check the context, then ask.

## Boundaries

- Customer data stays inside Acme systems.
- When in doubt, ask before acting externally.
`
);
write(
  'USER.md',
  `
# About Alex Chen

## Identity

- **Name:** Alex Chen
- **Home timezone:** ${TZ}
- Communication and writing style live in [SOUL.md](SOUL.md); workflow and engineering standards live in [AGENTS.md](AGENTS.md).

## How to Talk to Me

Direct and technical, no preamble. Lead with the number; I read the first line and decide whether the rest earns my time.

## Deeper

- [Profile](knowledge/user/profile.md)
- [Skills](knowledge/user/skills.md)
- [Preferences](knowledge/user/preferences.md)
`
);
if (AVATAR) {
  mkdirSync(join(HOME_DIR, 'assets'), { recursive: true });
  copyFileSync(resolve(AVATAR), join(HOME_DIR, 'assets', 'ace-avatar.jpg'));
}

// Knowledge: facets, concepts, memory, lint, raw inputs.
write(
  'knowledge/index.md',
  `
# Knowledge

## User (Alex Chen)

- [[user/profile]] — role, background, working hours
- [[user/skills]] — Go, TypeScript, Postgres, billing and logistics systems
- [[user/preferences]] — lead with the number, deep work before noon

## Concepts (cross-cutting patterns)

- [[concepts/activation-funnel]] — Step-by-step activation model and where Acme leaks new workspaces
- [[concepts/agentic-code-review]] — Two-pass agent review: correctness first, then simplification
- [[concepts/brain-fed-planning]] — Weekly planning that starts from the compiled brain, not a blank doc
- [[concepts/incident-runbook-loop]] — Every postmortem ends with a runbook diff in the brain

## Memory

- [[memory/index]] — hot context loaded every session
`
);
write(
  'knowledge/user/profile.md',
  `
---
title: Alex Chen - Profile
updated: ${day(-2)}
---

# Alex Chen

Co-founder and CTO of Acme, a B2B logistics SaaS scaling past launch. Previously staff engineer at two startups through Series B. Writes Go and TypeScript; reviews everything touching billing.

## Role

- Owns platform, billing, and the SOC 2 track.
- Runs the Monday planning review and the weekly launch standup.

## Working Hours

- 10:00-19:00 ET. The deep-work block before noon is sacred: no meetings, no pings.

## Signal Topics

- Agentic coding tools and review workflows.
- Usage-based billing and revenue recognition.
- Logistics software and freight tech.
`
);
write(
  'knowledge/user/skills.md',
  '# Alex Chen - Skills\n\n- Go services, TypeScript on the web, Postgres at scale.\n- Billing systems: Stripe, usage metering, reconciliation.\n'
);
write(
  'knowledge/user/preferences.md',
  '# Alex Chen - Preferences\n\n- Lead with the number.\n- Deep work before noon; batch messages after lunch.\n'
);
const concepts: Record<string, string> = {
  'activation-funnel':
    'Activation is five steps from signup to the first dispatched load. Step 2 (connecting a carrier) is the leak: 31% drop-off after the onboarding email rework.',
  'agentic-code-review':
    'Every agent-authored PR gets two passes: correctness first, then simplification. Adopted team-wide after it cut review time by 40%.',
  'brain-fed-planning':
    "Monday planning starts from the compiled brain: active threads, stale tasks, and last week's decisions, before anyone opens a doc.",
  'incident-runbook-loop':
    'A postmortem is not done until the runbook in the brain changed. Two false pages in June came from stale runbooks.'
};
Object.entries(concepts).forEach(([slug, body]) =>
  write(
    `knowledge/concepts/${slug}.md`,
    `---\ntitle: ${slug.replaceAll('-', ' ')}\ncreated: ${day(-40)}\nupdated: ${day(-3)}\n---\n\n# ${slug.replaceAll('-', ' ')}\n\n${body}\n`
  )
);
write(
  'knowledge/memory/index.md',
  `
# Memory

## Active Threads

- 🚀 **v2 launch** · window locked for ${day(14)}; marketing page staged, changelog drafted. [[projects/platform/tasks/pf-104-v2-load-test|pf-104]] load test is the last gate.
- 🎯 **SOC 2 Type II** · fieldwork starts ${day(28)}; evidence 80% done, cp-031 due this week.
- 🚨 **Billing migration** (Stripe to usage-based) · dual-write live since ${day(-6)}; cutover gated on pf-101.
- 📱 **Mobile 3.2** · in App Store review; the push opt-in experiment is queued behind it.
- 📈 **Activation leak** · step-2 drop-off 38% to 31% after the email rework; gr-012 is the next lever.

## Recent Decisions (Last 2 Weeks)

- **${day(-1)}** — Load test at 5x peak, not 10x: 10x costs three extra days and the v2 traffic model doesn't justify it.
- **${day(-2)}** — Billing cutover hard date set, gated on the dual-write reconciliation report.
- **${day(-4)}** — Incident runbooks live in the brain, not the wiki; every postmortem ends with a runbook diff.
- **${day(-6)}** — Two-pass agent code review team-wide.
- **${day(-9)}** — Empty-state redesign over the pricing experiment: step 2 is the leak, not the paywall.

## Pending

- pf-104 load test · staging booked for Thursday.
- cp-031 access reviews · 3 of 5 systems done; Okta and AWS remain.
- Senior platform engineer hire · two onsites this week.

## Key Context

- Acme: B2B logistics SaaS, about 40 staff, Series A.
- Stack: Go services, Postgres, a React web app, React Native mobile.

## Learnings

- Lead with the number. Alex reads the first line only unless it earns the rest.
- Never page before checking the runbook.
- Staging data is not production data; confirm funnel numbers on production before a board brief.

## Daily Memory

- [[memory/${day(0)}]] — Reconciliation walk; exporter bug root-caused and filed as pf-099.
- [[memory/${day(-1)}]] — Load-test target locked at 5x; reconciliation dashboard specced.
- [[memory/${day(-2)}]] — SOC 2 evidence sprint; 3.2 release checklist walked and submitted.
`
);
[0, -1, -2].forEach((offset) =>
  write(
    `knowledge/memory/${day(offset)}.md`,
    `# ${day(offset)}\n\n- Worked the launch threads; see the session log for detail.\n`
  )
);
write(
  '.kevin/lint.md',
  `# Knowledge Lint Report\n\nDate: ${isoOf(minutesAgo(40))}\n\n## Summary\n\n- Remaining issues: 2\n- Errors: 0\n- Warnings: 1\n- Suggestions: 1\n\n## Memory budget\n\n- **WARN**: Active Threads bullet 1 is 262 characters (budget 250)\n- **SUGGESTION**: concepts/brain-fed-planning has no inbound links\n`
);
write(
  'knowledge/raw/user/feedback.md',
  `# Feedback\n\n## ${day(-3)} — lead with the number\n\nPut the number first; I stop reading after one line.\n`
);
write(
  'knowledge/raw/inbox/carrier-api-rate-limits.md',
  '# Carrier API rate limits\n\nNotes from the partner call, to compile.\n'
);

// Sessions: day-files, the session index, the radar report, and one transcript.
const SESSION = {
  recon: '3f1c9a2e-5b7d-4e21-9c0a-8d4b2f6e1a90',
  loadTest: '7b2e4d91-0c3a-4f6e-8a15-2d9c7e4b1f38',
  soc2: 'c94a1e27-6d8b-4b3f-9e02-5a7f1c3d8e64',
  sync: 'a1d3f5b7-9c2e-4a6b-8d0f-1e3c5a7b9d2f'
};
const sessionBlock = (when: Date, id: string, cwd: string, turns: string, user: string) =>
  `### Session (${clockOf(when)}) [${id}] · ${dateOf(when)} · ${cwd} · turns ${turns} · claude: claude-opus-5-5\n\n**User:** ${user}\n\n**Assistant:** Done; details in the thread.\n`;
write(
  `knowledge/raw/sessions/${day(0)}.md`,
  `# Session Log: ${day(0)}\n\n${[
    sessionBlock(minutesAgo(35), SESSION.sync, '~/agent-acme', '1–22', 'run the morning sync'),
    sessionBlock(
      minutesAgo(15),
      SESSION.recon,
      '~/acme/platform',
      '1–35',
      'walk the billing reconciliation numbers with me'
    )
  ].join('\n---\n\n')}`
);
write(
  `knowledge/raw/sessions/${day(-1)}.md`,
  `# Session Log: ${day(-1)}\n\n${sessionBlock(atYesterday('15:20'), SESSION.loadTest, '~/acme/platform', '1–19', 'should the load test target 10x or 5x peak')}`
);
write(
  `knowledge/raw/sessions/${day(-2)}.md`,
  `# Session Log: ${day(-2)}\n\n${sessionBlock(atYesterday('11:00'), SESSION.soc2, '~/acme', '1–31', 'soc2 evidence sprint')}`
);
const WEEK = [0, -1, -2, -3, -4, -5, -6];
WEEK.slice(3).forEach((offset) =>
  write(
    `knowledge/raw/sessions/${day(offset)}.md`,
    `# Session Log: ${day(offset)}\n\n${'**User:** keep the launch threads moving\n\n**Assistant:** Progress logged on the task threads.\n\n'.repeat(4 + ((offset * -7) % 5))}`
  )
);
const history: [string, number, number, string, string][] = [
  [
    SESSION.recon,
    0,
    35,
    'fix the exporter timezone rounding and replay the 41 mismatched invoices as a regression test',
    '~/acme/platform'
  ],
  [SESSION.sync, 0, 22, '/agent-kevin:sync', '~/agent-acme'],
  [
    '5e8c2a4f-1b7d-4c9e-a3f6-0d2b8e5c7a19',
    0,
    9,
    'prep interview debrief notes for the two platform onsites and compile them into the hiring doc',
    '~/acme'
  ],
  [
    '9d4f6b8e-2a1c-4e3d-b5f7-8c0a2e4d6f13',
    0,
    27,
    'build the empty-state variant behind a flag; the design link is in gr-012',
    '~/acme/web'
  ],
  [
    '2c6e8a0b-4d3f-4b5a-9c7e-1f3a5c7e9b24',
    0,
    14,
    'draft the okta access review from the export and flag anything stale',
    '~/acme'
  ],
  [SESSION.loadTest, -1, 19, 'should the load test target 10x or 5x peak', '~/acme/platform'],
  [
    '6f0b2d4a-8c7e-4a1b-93d5-7e9f1b3d5a86',
    -1,
    42,
    'reconciliation dashboard: match rate by day and a drilldown into mismatches',
    '~/acme/platform'
  ],
  [
    '0a2c4e6f-8b1d-4f3a-a5c7-9e1b3d5f7a02',
    -1,
    15,
    'confirm the funnel numbers on production before we brief the board',
    '~/acme/growth'
  ],
  ['8e1a3c5d-7f9b-4d2e-b4a6-c8e0a2b4c6d8', -1, 11, '/agent-kevin:evening-briefing', '~/agent-acme'],
  [SESSION.soc2, -2, 31, 'soc2 evidence sprint: pull the access lists and draft the review docs', '~/acme'],
  [
    '4b6d8f0a-2c4e-4a6c-8e0b-2d4f6a8c0e21',
    -2,
    24,
    'walk the 3.2 release checklist with me before we submit',
    '~/acme/mobile'
  ]
];
write(
  'knowledge/raw/sessions/index.json',
  `${JSON.stringify(
    {
      schema: 1,
      sessions: Object.fromEntries(
        history.map(([id, offset, turns, briefing, cwd]) => [
          id,
          {
            first_seen: day(offset),
            last_seen: day(offset),
            cwd,
            captured_turns: turns,
            last_turn_fp: id.slice(0, 8),
            briefing,
            blocks: [{ date: day(offset), from: 1, to: turns }]
          }
        ])
      )
    },
    null,
    2
  )}\n`
);
write(
  '.kevin/knowledge.json',
  `${JSON.stringify(
    {
      ingested: Object.fromEntries(
        WEEK.map((offset, index) => [
          `${day(offset)}.md`,
          {
            hash: `h${index}`,
            compiled_at: isoOf(minutesAgo(30 + index * 1440)),
            cost_usd: 0.38 + index / 10,
            bytes: 2400,
            prefix_hash: `p${index}`
          }
        ])
      ),
      in_flight: null,
      partial: {},
      query_count: 0,
      last_lint: isoOf(minutesAgo(40))
    },
    null,
    2
  )}\n`
);
writeAt(
  FAKE_HOME,
  `.claude/projects/-home-alex-acme-platform/${SESSION.recon}.jsonl`,
  [
    { type: 'user', message: { content: 'walk the billing reconciliation numbers with me' } },
    {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'text',
            text: 'The mismatch is the exporter rounding; filed as pf-099, and pf-101 carries the report.'
          },
          { type: 'tool_use', input: { file_path: `reports/plans/${day(-1)}-1410-billing-cutover-plan.md` } }
        ]
      }
    }
  ]
    .map((line) => JSON.stringify(line))
    .join('\n')
);

// Projects and tasks, dated relative to today so nothing reads overdue.
const projects: Record<string, string> = {
  platform: 'Core API, billing, and infrastructure. Owns the v2 launch and the usage-based billing migration.',
  compliance: 'SOC 2 Type II track. Audit fieldwork starts in four weeks.',
  growth: 'Activation funnel, onboarding, and SEO. North star: weekly active workspaces.',
  mobile: 'iOS and Android shipping app (React Native). 3.2 is in App Store review.'
};
Object.entries(projects).forEach(([slug, description]) =>
  write(`projects/${slug}/README.md`, `# ${slug[0].toUpperCase()}${slug.slice(1)}\n\n${description}\n`)
);
interface DemoTask {
  id: string;
  project: string;
  slug: string;
  title: string;
  status: string;
  priority: string;
  due: number | null;
  updated: number;
  blockedBy?: string;
  dependsOn?: string[];
  archived?: boolean;
}
const tasks: DemoTask[] = [
  {
    id: 'pf-101',
    project: 'platform',
    slug: 'billing-reconciliation-report',
    title: 'Billing dual-write reconciliation report (cutover go/no-go)',
    status: 'active',
    priority: 'P0',
    due: 2,
    updated: 0
  },
  {
    id: 'pf-104',
    project: 'platform',
    slug: 'v2-load-test',
    title: 'v2 load test at 5x peak (launch gate)',
    status: 'open',
    priority: 'P0',
    due: 3,
    updated: -1
  },
  {
    id: 'pf-099',
    project: 'platform',
    slug: 'exporter-timezone-rounding',
    title: 'Fix timezone rounding in the legacy billing exporter',
    status: 'open',
    priority: 'P1',
    due: null,
    updated: 0
  },
  {
    id: 'pf-097',
    project: 'platform',
    slug: 'dual-write-shadow-mode',
    title: 'Dual-write shadow mode for usage billing',
    status: 'done',
    priority: 'P1',
    due: null,
    updated: -6,
    archived: true
  },
  {
    id: 'cp-031',
    project: 'compliance',
    slug: 'q3-access-reviews',
    title: 'Quarterly access reviews (SOC 2 evidence)',
    status: 'active',
    priority: 'P1',
    due: 4,
    updated: 0
  },
  {
    id: 'cp-028',
    project: 'compliance',
    slug: 'vendor-dpa-sweep',
    title: 'Vendor inventory and DPA sweep',
    status: 'open',
    priority: 'P2',
    due: 18,
    updated: -12
  },
  {
    id: 'gr-012',
    project: 'growth',
    slug: 'empty-state-redesign',
    title: 'Empty-state redesign (activation step-2 leak)',
    status: 'active',
    priority: 'P1',
    due: 8,
    updated: -1
  },
  {
    id: 'gr-009',
    project: 'growth',
    slug: 'onboarding-email-rework',
    title: 'Onboarding email rework',
    status: 'done',
    priority: 'P2',
    due: null,
    updated: -9,
    archived: true
  },
  {
    id: 'mb-032',
    project: 'mobile',
    slug: 'release-3-2',
    title: 'Mobile 3.2 App Store review and release',
    status: 'blocked',
    priority: 'P1',
    due: 4,
    updated: -2,
    blockedBy: 'Submitted; waiting on Apple review (typically 2 to 4 days).'
  },
  {
    id: 'mb-034',
    project: 'mobile',
    slug: 'push-opt-in-experiment',
    title: 'Push-notification opt-in experiment',
    status: 'blocked',
    priority: 'P2',
    due: null,
    updated: -2,
    blockedBy: 'Needs 3.2 live (mb-032).',
    dependsOn: ['mb-032']
  }
];
tasks.forEach((task) =>
  write(
    `projects/${task.project}/tasks/${task.archived ? 'archive/' : ''}${task.id}-${task.slug}.md`,
    `---
schema: 1
id: ${task.id}
title: "${task.title}"
type: task
status: ${task.status}
priority: ${task.priority}
project: ${task.project}
assignee: [alex]
labels: []
created: ${day(task.updated - 10)}
updated: ${day(task.updated)}
due: ${task.due === null ? '' : day(task.due)}
depends_on: [${(task.dependsOn ?? []).join(', ')}]
blocked_by: "${task.blockedBy ?? ''}"
parent:
closed: ${task.archived ? day(task.updated) : ''}
---

## Description

${task.title}.

## Checklist

- [x] Scope agreed
- [ ] Shipped and verified

## Thread

> [!info] ace · ${day(task.updated)} 09:10
> Picked up; next step is on the checklist.
`
  )
);
write(
  'projects/TASKS.md',
  `<!-- GOALS:START -->
## Weekly Goals — Week of ${day(-((now.getDay() + 6) % 7))}

Ship the pf-101 reconciliation report and clear the exporter bug (pf-099)
Run the 5x load test and publish the launch go/no-go (pf-104)
Finish the Okta and AWS access reviews (cp-031)

## Monthly Goals

v2 launched with zero Sev-1s in week one
Usage-based billing cutover, reconciliation-gated
Weekly active workspaces 1,840 to 2,100

## Yearly Goals

**Q3** — v2 launch, billing migration, and clean SOC 2 Type II fieldwork
**Q4** — 2,500 weekly active workspaces; two senior platform engineers hired
<!-- GOALS:END -->
`
);

// Reports: a morning brief with news, a flywheel pass, the radar, a plan, a review, and last night's wrap.
interface DemoReport {
  when: Date;
  category: string;
  slug: string;
  title: string;
  skill: string;
  status: string;
  emoji: string;
  body: string;
}
const reportFile = (report: DemoReport) =>
  `${report.category}/${dateOf(report.when)}-${clockOf(report.when).replace(':', '')}-${report.slug}.md`;
const reports: DemoReport[] = [
  {
    when: minutesAgo(30),
    category: 'briefings',
    slug: 'morning',
    title: 'Morning brief: launch week minus 14',
    skill: 'morning-briefing',
    status: 'findings',
    emoji: '🟠',
    body: `# Morning brief\n\n📋 Today: pf-101 reconciliation report, then the pf-104 load-test prep.\n\n🌐 Signals\n  • 🤖 [Claude Sonnet 5 lands with a 1M-token context and cheaper agentic pricing](https://www.anthropic.com/news) (anthropic.com) — review costs drop again.\n  • 🧪 [DeepEval 4.0 ships an open-source eval harness for coding agents](https://github.com/confident-ai/deepeval) (github.com) — a cheap way to grade our agent PRs.\n📰 News\n  • 🌍 [AWS stands up a $1B forward-deployed engineering org](https://www.reuters.com/technology/) (reuters.com) — the channel war moves to services.\n  • 💳 [Stripe expands usage-based billing primitives](https://stripe.com/blog) (stripe.com) — relevant to the cutover.\n👉 First move: finish the reconciliation diff before the 11:00 standup.\n`
  },
  {
    when: minutesAgo(32),
    category: 'briefings',
    slug: 'flywheel',
    title: 'Flywheel: reconciliation drafted, exporter bug filed',
    skill: 'flywheel',
    status: 'findings',
    emoji: '🟠',
    body: '# Flywheel\n\n- pf-101 advanced; pf-099 filed from the reconciliation walk.\n- cp-028 is going stale.\n'
  },
  {
    when: minutesAgo(33),
    category: 'radar',
    slug: 'where-am-i',
    title: 'Where am I: 3 sessions across 24h',
    skill: 'where-am-i',
    status: 'clean',
    emoji: '🟢',
    body: `> Launch-week prep across three threads: billing reconciliation, the load-test harness, and SOC 2 evidence.

|   | # | Session | Last |
|---|---|---------|------|
| 🚧 | 1 | Billing reconciliation walk | *15m* · exporter bug filed |
| ✅ | 2 | Load-test target | *yesterday* · 5x locked |
| ✅ | 3 | SOC 2 evidence sprint | *2 days* · 3 of 5 reviews |

## 🟢 In motion (last hour)

**1. Billing reconciliation walk** · *15m ago*

Week-1 dual-write numbers reviewed; the exporter's timezone rounding explains all 41 mismatches, filed as pf-099.

↳ \`claude --resume ${SESSION.recon}\`

## 🕐 Earlier

**2. Load-test target** · *yesterday*

Settled 5x over 10x; staging booked for Thursday.

↳ \`claude --resume ${SESSION.loadTest}\`

**3. SOC 2 evidence sprint** · *2 days ago*

Access reviews 3 of 5 done; the Okta checklist is drafted.

↳ \`claude --resume ${SESSION.soc2}\`

---
*3 sessions · 24h window · scoped to ~/agent-acme*
`
  },
  {
    when: atYesterday('14:10'),
    category: 'plans',
    slug: 'billing-cutover-plan',
    title: 'Plan: usage-billing cutover, reconciliation-gated',
    skill: 'plan-spec',
    status: 'draft',
    emoji: '⏳',
    body: '# Billing cutover plan\n\n1. Reconciliation report green for 7 days → verify: match rate ≥ 99.9%.\n2. Flip reads to usage billing → verify: invoice diff is empty.\n'
  },
  {
    when: atYesterday('16:40'),
    category: 'reviews',
    slug: 'pr-212-exporter-rounding',
    title: 'PR #212 (jordan): exporter rounding fix, approve with one fix',
    skill: 'pr-review',
    status: 'findings',
    emoji: '🟠',
    body: '# PR #212\n\nOne finding: the regression test replays 40 of the 41 invoices.\n'
  },
  {
    when: atYesterday('18:05'),
    category: 'briefings',
    slug: 'evening',
    title: 'Evening wrap: load-test target locked at 5x',
    skill: 'evening-briefing',
    status: 'clean',
    emoji: '🟢',
    body: '# Evening wrap\n\n- Shipped: load-test target decision.\n- Tomorrow: reconciliation walk first.\n'
  }
];
reports.forEach((report) =>
  write(
    `reports/${reportFile(report)}`,
    `---\ntitle: ${report.title}\nskill: ${report.skill}\ncreated: ${isoOf(report.when)}\nstatus: ${report.status}\n---\n\n${report.body}`
  )
);
const reportDays = [...new Set(reports.map((report) => dateOf(report.when)))].sort().reverse();
write(
  'reports/index.md',
  `# Reports\n\n${reportDays
    .map(
      (date) =>
        `## ${date}\n\n${reports
          .filter((report) => dateOf(report.when) === date)
          .map(
            (report) =>
              `- ${clockOf(report.when)} · [${report.title}](${reportFile(report)}) · \`${report.skill}\` · ${report.emoji} ${report.status}`
          )
          .join('\n')}\n`
    )
    .join('\n')}`
);

// Runtime state, settings, rules, logs.
write(
  '.kevin/version.json',
  `${JSON.stringify({ templateVersion: plugin.version, initializedAt: day(-60), history: [] }, null, 2)}\n`
);
write(
  '.kevin/logs/app.log',
  [minutesAgo(35), minutesAgo(33), minutesAgo(31)]
    .map(
      (when, index) =>
        `${when.toISOString()} ${index === 1 ? 'WARN ' : 'INFO '} [🤖 system] [cli] ${index === 1 ? 'compile: one inbox item deferred' : 'dashboard'}`
    )
    .join('\n') + '\n'
);
write(
  '.claude/settings.json',
  `${JSON.stringify(
    {
      enabledPlugins: { 'agent-kevin@agentlayer': true },
      extraKnownMarketplaces: { agentlayer: { source: { source: 'github', repo: 'AgentLayer1/agent-kevin' } } },
      permissions: {
        allow: ['mcp__plugin_agent-kevin_kevin__task_query', 'Skill(agent-kevin:engineer)', 'Skill(agent-kevin:sync)'],
        deny: ['Read(./.kevin/secrets/**)']
      }
    },
    null,
    2
  )}\n`
);
write(
  '.claude/settings.local.json',
  `${JSON.stringify({ env: { AGENT_HOME_TIMEZONE: TZ, AGENT_CODE_PATH: '~/acme/platform' } }, null, 2)}\n`
);
const rule = (globs: string[], body: string) =>
  `---\npaths:\n${globs.map((glob) => `  - "${glob}"`).join('\n')}\n---\n\n${body}\n`;
write(
  '.claude/rules/typescript.md',
  rule(['**/*.ts', '**/*.tsx'], '# TypeScript Rules\n\n- Discriminated unions over optional-field bags.')
);
write(
  '.claude/rules/sql.md',
  rule(['**/*.sql', '**/migrations/**'], '# SQL Rules\n\n- Run a bulk UPDATE as a SELECT first.')
);
write('.claude/rules/mobile.md', rule(['apps/mobile/**'], '# Mobile Rules\n\n- Pressable over TouchableOpacity.'));
writeAt(
  FAKE_HOME,
  '.claude/settings.json',
  `${JSON.stringify({ env: { KEVIN_HOME: '~/agent-acme', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }, enabledPlugins: { 'skill-creator@claude-plugins-official': true, 'typescript-lsp@claude-plugins-official': true } }, null, 2)}\n`
);

// A host shim so the version check passes, and a git history so the brain shows commits.
const shimDir = join(ROOT, 'bin');
writeAt(ROOT, 'bin/claude', '#!/bin/sh\necho "2.1.300 (Claude Code)"\n');
chmodSync(join(shimDir, 'claude'), 0o755);
const git = (...gitArgs: string[]) =>
  spawnSync('git', ['-C', HOME_DIR, '-c', 'user.name=Ace', '-c', 'user.email=ace@acme.example', ...gitArgs], {
    env: { PATH: `/opt/homebrew/bin:/usr/bin:/bin`, HOME: FAKE_HOME }
  });
git('init', '-q');
git('add', '-A');
git('commit', '-q', '-m', 'Sync: update knowledge');

const render = spawnSync(process.execPath, [join(REPO, 'bin', 'kevin'), 'dashboard'], {
  cwd: HOME_DIR,
  env: {
    PATH: `${shimDir}:${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`,
    HOME: FAKE_HOME,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    AGENT_TIMEZONE: TZ,
    KEVIN_HOME: HOME_DIR,
    AGENT_LOG_FILE: 'off'
  }
});
if (render.status !== 0) {
  console.error(render.stderr.toString() || render.stdout.toString());
  process.exit(1);
}

// Publishable output: every temp and machine path rewritten, staleness disabled, demo links explained.
const pathForms = (from: string, to: string): [string, string][] => [
  [from, to],
  [encodeURIComponent(from), encodeURIComponent(to)],
  [encodeURI(from), encodeURI(to)]
];
const rewrites = [...new Set([FAKE_HOME, realpathSync(FAKE_HOME)])]
  .flatMap((path) => pathForms(path, PUBLIC_HOME))
  .concat(pathForms(REPO, PUBLIC_PLUGIN));
const DEMO_ALERT =
  "<script>document.addEventListener('click',function(ev){var a=ev.target&&ev.target.closest?ev.target.closest('a'):null;if(!a)return;var h=a.getAttribute('href')||'';if(h.indexOf('file:')===0||h.indexOf('obsidian:')===0){ev.preventDefault();alert('This is a demo dashboard for a fictitious company (Acme).\\n\\nIn a real deployment this link opens the underlying markdown file in your editor or Obsidian: every task, briefing, and brain article is a plain file on your own infrastructure.');}},true);</script>";
const html = rewrites
  .reduce((text, [from, to]) => text.replaceAll(from, to), readFileSync(join(HOME_DIR, 'dashboard.html'), 'utf-8'))
  .replace(/data-stale-hours="\d+"/, 'data-stale-hours="876000"')
  .replace('</body>', `${DEMO_ALERT}\n</body>`);

const leaks = [
  '/Users/',
  '/private/',
  ROOT,
  encodeURIComponent(ROOT),
  '%2FUsers',
  '%2Fprivate',
  '%2Ftmp',
  '%2Fvar'
].filter((needle) => html.includes(needle));
if (leaks.length > 0) {
  console.error(`refusing to write: the render still contains ${leaks.join(', ')} (seed kept at ${ROOT})`);
  process.exit(1);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(JSON.stringify({ out: OUT, bytes: html.length, seed: args.includes('--keep') ? ROOT : null }));
if (!args.includes('--keep')) {
  spawnSync('rm', ['-rf', ROOT]);
}
if (!existsSync(OUT)) {
  process.exit(1);
}
