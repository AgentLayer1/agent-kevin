import { describe, expect, test } from 'bun:test';
import type { StatusSnapshot, TaskRef } from './collect';
// Only config-free modules may be imported at runtime here: bun test shares
// one module registry across test files, and the first @/config evaluation
// freezes KEVIN_HOME for the whole process — clobbering pipeline.test.ts's
// hermetic temp HOME. html-render is pure by design (see its header).
import { PAGES, escapeHtml, renderDashboardHtml } from './html-render';

const taskRef = (overrides: Partial<TaskRef> = {}): TaskRef => ({
  id: 'lo-001',
  title: 'A perfectly normal task',
  priority: 'P1',
  project: 'life-os',
  status: 'active',
  due: '2026-06-30',
  updated: '2026-06-10',
  dependsOn: [],
  blockedBy: '',
  path: 'projects/life-os/tasks/lo-001-a-perfectly-normal-task.md',
  ...overrides
});

const makeSnapshot = (overrides: Partial<StatusSnapshot> = {}): StatusSnapshot => ({
  runtime: {
    version: '0.1.4',
    pluginName: 'agent-kevin',
    home: '/tmp/home',
    pluginRoot: '/tmp/plugin',
    knowledgePath: '/tmp/home/knowledge',
    projectsPath: '/tmp/home/projects',
    reportsPath: '/tmp/home/reports',
    statePath: '/tmp/home/.kevin',
    logsPath: '/tmp/home/.kevin/logs',
    timezone: 'Asia/Kuala_Lumpur',
    date: 'Thu 11 Jun',
    isoDate: '2026-06-11',
    time: '10:00'
  },
  markdownUrl: 'obsidian://open?path={path}',
  persona: {
    name: 'Kevin',
    kind: 'AI assistant (Claude Code plugin)',
    vibe: 'Sharp but approachable, slightly funny.',
    emoji: '🍌',
    avatar: '.claude/assets/kevin-avatar.jpg',
    bio: 'A personal AI assistant that runs as a Claude Code plugin.',
    roles: ['General-purpose personal assistant'],
    soulTraits: ['Concise by default. Walls of text are a crime.']
  },
  operator: {
    name: 'Basem',
    timezone: 'Asia/Kuala_Lumpur',
    avatar: 'knowledge/user/assets/avatar.jpg',
    headline: 'Software engineer and founder with 20+ years of experience.',
    profileSections: [{ title: 'Identity', lines: ['Full name: Basem Emara', 'Location: Cyberjaya, Malaysia'] }],
    facets: [{ name: 'profile', description: 'bio, identity, family', bytes: 1024, href: 'knowledge/user/profile.md' }]
  },
  skills: {
    count: 2,
    names: ['sync', 'status'],
    custom: 0,
    details: [
      { name: 'sync', description: 'End-to-end refresh of every derived view.', custom: false },
      { name: 'status', description: 'Command-center overview of the whole agent.', custom: false }
    ]
  },
  mcp: {
    servers: ['kevin'],
    toolCount: 2,
    tools: ['mcp__kevin__task_dashboard', 'mcp__kevin__status_dashboard'],
    toolDetails: [
      { name: 'mcp__kevin__status_dashboard', description: 'Rebuild the Agent OS dashboard.' },
      { name: 'mcp__kevin__task_dashboard', description: 'Rebuild projects/TASKS.md.' }
    ]
  },
  goals: { monthly: ['Ship the MD Status application'], weekly: [] },
  memoryThreads: ['al-005 MD portal blocked on 2-member rule', 'Walapay = day job, Ring 1'],
  memoryDecisions: ['BP v2.4→v2.5: third-party AI scrubbed'],
  memoryLearnings: ['One approval is not blanket commit license.'],
  memoryPending: ['al-014 corporate bank account awaiting CIMB HQ.'],
  memoryDailyFiles: [
    { name: '2026-06-10', href: 'knowledge/memory/2026-06-10.md', summary: 'al-016 decided; BP reworked.' }
  ],
  sessions: [
    {
      id: 'abc12345',
      firstSeen: '2026-06-11',
      lastSeen: '2026-06-11',
      turns: 13,
      cwd: '~/Documents/Agents/Kevin',
      briefing: 'Morning sync and MDEC portal work'
    }
  ],
  hooks: { events: ['SessionStart'], count: 1, entries: [{ event: 'SessionStart', command: 'kevin session-start' }] },
  knowledge: {
    concepts: 1,
    conceptNames: ['flywheel-model'],
    conceptDetails: [
      {
        name: 'flywheel-model',
        description: 'Projects cross-pollinate into deeper skills',
        href: 'knowledge/concepts/flywheel-model.md'
      }
    ],
    userFacets: 1,
    facets: [{ name: 'profile', bytes: 1024 }],
    memoryDaily: 3,
    memoryIndexBytes: 2048,
    activeThreads: 2,
    learnings: 4,
    inboxItems: 0,
    feedbackBytes: 512,
    totalBytes: 100_000,
    sessionsWeek: [
      { day: '2026-06-05', label: 'Fri', bytes: 0 },
      { day: '2026-06-06', label: 'Sat', bytes: 100 },
      { day: '2026-06-07', label: 'Sun', bytes: 0 },
      { day: '2026-06-08', label: 'Mon', bytes: 2000 },
      { day: '2026-06-09', label: 'Tue', bytes: 300 },
      { day: '2026-06-10', label: 'Wed', bytes: 0 },
      { day: '2026-06-11', label: 'Thu', bytes: 50 }
    ]
  },
  compile: {
    ingested: 10,
    sessionFiles: 10,
    pending: 0,
    lastCompiled: '2026-06-11T01:00:00Z',
    totalCostUsd: 1.23,
    recent: [{ day: '2026-06-10', cost: 0.5, at: '2026-06-11T01:00:00Z' }]
  },
  tasks: {
    active: 1,
    blocked: 1,
    open: 1,
    stale: 0,
    overdue: 0,
    total: 3,
    projects: 1,
    byProject: [
      {
        project: 'life-os',
        open: 1,
        active: 1,
        blocked: 1,
        total: 3,
        done: 5,
        updatedAt: '2026-06-10',
        description: 'Agentic personal AI operating system.'
      }
    ],
    overdueList: [],
    staleList: [],
    activeList: [taskRef()],
    queue: [
      taskRef(),
      taskRef({ id: 'lo-002', title: 'Due today task', due: '2026-06-11', status: 'open', priority: 'P2' }),
      taskRef({
        id: 'lo-003',
        title: 'Blocked task',
        due: '',
        status: 'blocked',
        blockedBy: 'Awaiting CIMB HQ approval'
      })
    ],
    touchedToday: [taskRef({ id: 'lo-002', title: 'Due today task', updated: '2026-06-11' })]
  },
  context: {
    source: '/tmp/home/CLAUDE.md',
    staticImports: [
      { label: 'SOUL.md', bytes: 100, present: true, group: 'identity' },
      { label: 'knowledge/index.md', bytes: 200, present: true, group: 'knowledge' }
    ],
    staticBytes: 300,
    dynamic: {
      date: '2026-06-11',
      entries: [{ label: 'session tail', bytes: 500, status: 'loaded' }],
      bytes: 500
    }
  },
  settings: {
    layers: [{ label: 'project', path: '/tmp/home/.claude/settings.json', present: true }],
    allow: 5,
    deny: 1,
    env: [{ key: 'KEVIN_API_KEY', value: '••••abcd', scope: 'workspace' }],
    enabledPlugins: ['agent-kevin@agentlayer'],
    plugin: { ref: 'agent-kevin@agentlayer', marketplace: 'agentlayer', sourceType: 'github', sourcePath: 'a/b' }
  },
  logs: {
    path: '/tmp/home/.kevin/logs/app.log',
    bytes: 1000,
    mtime: '10:00',
    warnings: 0,
    errors: 0,
    totalWarnings: 3,
    totalErrors: 1,
    lastError: null,
    tail: '2026-06-11T01:00:00Z INFO [system] all quiet'
  },
  reports: [
    {
      date: '2026-06-11',
      time: '09:04',
      title: 'Morning brief',
      href: 'reports/briefings/2026-06-11-0904-morning.md',
      skill: 'morning-briefing',
      status: '🟠'
    }
  ],
  reportsTotal: 12,
  health: { overdue: 0, stale: 0, pendingCompiles: 0, logErrors: 0, missingImports: 0, ok: true },
  ...overrides
});

describe('renderDashboardHtml', () => {
  test('renders every page, nav items for visible ones, and one document shell', () => {
    const html = renderDashboardHtml(makeSnapshot());
    for (const item of PAGES) {
      expect(html).toContain(`data-page="${item.id}"`);
      const hasNav = html.includes(`data-nav="${item.id}"`);
      expect(hasNav).toBe(!('hidden' in item && item.hidden));
    }
    expect(html.match(/<!doctype html>/g)?.length).toBe(1);
    expect(html).toContain('class="badge ok"');
    expect(html).toContain('Good morning, Basem');
  });

  test('today page surfaces goals, due-today work, blockers, and the activity trail', () => {
    const html = renderDashboardHtml(makeSnapshot());
    expect(html).toContain('Ship the MD Status application');
    expect(html).toContain('Due today task');
    expect(html).toContain('Awaiting CIMB HQ approval');
    expect(html).toContain('Today so far');
    expect(html).toContain('Tasks touched');
    expect(html).toContain('Morning sync and MDEC portal work');
  });

  test('brain page carries threads, decisions, concepts, and the memory tab', () => {
    const html = renderDashboardHtml(makeSnapshot());
    expect(html).toContain('al-005 MD portal blocked on 2-member rule');
    expect(html).toContain('BP v2.4→v2.5: third-party AI scrubbed');
    expect(html).toContain('Projects cross-pollinate into deeper skills');
    expect(html).toContain('One approval is not blanket commit license.');
    expect(html).toContain('al-014 corporate bank account awaiting CIMB HQ.');
    expect(html).toContain(`obsidian://open?path=${encodeURIComponent('/tmp/home/knowledge/memory/2026-06-10.md')}`);
  });

  test('profile page renders the operator with avatar, profile sections, and facets', () => {
    const html = renderDashboardHtml(makeSnapshot());
    expect(html).toContain('data-page="profile"');
    expect(html).toContain('src="knowledge/user/assets/avatar.jpg"');
    expect(html).toContain('Software engineer and founder with 20+ years of experience.');
    expect(html).toContain('Full name: Basem Emara');
    expect(html).toContain('bio, identity, family');
    expect(html).toContain(`obsidian://open?path=${encodeURIComponent('/tmp/home/knowledge/user/profile.md')}`);
  });

  test('daily memory renders as rows with manifest summaries', () => {
    const html = renderDashboardHtml(makeSnapshot());
    expect(html).toContain('al-016 decided; BP reworked.');
  });

  test('persona page renders Kevin from IDENTITY/SOUL, not file names', () => {
    const html = renderDashboardHtml(makeSnapshot());
    expect(html).toContain('src=".claude/assets/kevin-avatar.jpg"');
    expect(html).toContain('Sharp but approachable, slightly funny.');
    expect(html).toContain('A personal AI assistant that runs as a Claude Code plugin.');
    expect(html).toContain('Concise by default. Walls of text are a crime.');
  });

  test('sessions page lists captured sessions with briefings', () => {
    const html = renderDashboardHtml(makeSnapshot());
    expect(html).toContain('Morning sync and MDEC portal work');
    expect(html).toContain('13 turns');
  });

  test('capabilities page lists skills and tools with descriptions', () => {
    const html = renderDashboardHtml(makeSnapshot());
    expect(html).toContain('/agent-kevin:sync');
    expect(html).toContain('End-to-end refresh of every derived view.');
    expect(html).toContain('status_dashboard');
    expect(html).toContain('Rebuild the Agent OS dashboard.');
  });

  test('markdown files open through Obsidian URIs', () => {
    const html = renderDashboardHtml(makeSnapshot());
    expect(html).toContain(
      `obsidian://open?path=${encodeURIComponent('/tmp/home/projects/life-os/tasks/lo-001-a-perfectly-normal-task.md')}`
    );
    expect(html).toContain(
      `obsidian://open?path=${encodeURIComponent('/tmp/home/reports/briefings/2026-06-11-0904-morning.md')}`
    );
    expect(html).toContain(
      `obsidian://open?path=${encodeURIComponent('/tmp/home/knowledge/concepts/flywheel-model.md')}`
    );
  });

  test('work page renders project cards with progress and description', () => {
    const html = renderDashboardHtml(makeSnapshot());
    expect(html).toContain('class="projcard"');
    expect(html).toContain('Agentic personal AI operating system.');
    expect(html).toContain('☑ 5 / 8');
    expect(html).toContain('63%');
  });

  test('system logs tab carries the scrollable tail', () => {
    const html = renderDashboardHtml(makeSnapshot());
    expect(html).toContain('class="logtail"');
    expect(html).toContain('all quiet');
  });

  test('escapes snapshot-derived strings everywhere they render', () => {
    const hostile = 'Fix <script>alert("x")</script> & co';
    const base = makeSnapshot();
    const html = renderDashboardHtml(
      makeSnapshot({
        operator: { ...base.operator, name: '<b>Basem</b>' },
        tasks: {
          ...base.tasks,
          activeList: [taskRef({ title: hostile, blockedBy: '<img src=x onerror=alert(1)>' })],
          queue: [taskRef({ title: hostile, path: 'projects/x/tasks/"onmouseover="alert(1)' })]
        }
      })
    );
    expect(html).not.toContain(hostile);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>Basem</b>');
    expect(html).toContain('Fix &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co');
  });

  test('makes zero external requests', () => {
    const html = renderDashboardHtml(makeSnapshot());
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/href="https?:/);
    expect(html).not.toMatch(/src="https?:/);
    expect(html).not.toMatch(/url\(\s*['"]?https?:/);
    expect(html).not.toMatch(/@import/);
  });

  test('unhealthy snapshot names the issues and anchors them', () => {
    const base = makeSnapshot();
    const html = renderDashboardHtml(
      makeSnapshot({
        tasks: { ...base.tasks, overdue: 2, overdueList: [taskRef(), taskRef({ id: 'lo-009' })] },
        health: { overdue: 2, stale: 0, pendingCompiles: 1, logErrors: 0, missingImports: 0, ok: false }
      })
    );
    expect(html).toContain('class="badge warn"');
    expect(html).toContain('2 overdue · 1 pending');
    expect(html).toContain('data-issue');
  });

  test('renders pre-redacted secrets verbatim, never raw values', () => {
    const html = renderDashboardHtml(makeSnapshot());
    expect(html).toContain('••••abcd');
  });
});

describe('escapeHtml', () => {
  test('escapes all five significant characters', () => {
    expect(escapeHtml(`<a href="x" data-y='&'>`)).toBe('&lt;a href=&quot;x&quot; data-y=&#39;&amp;&#39;&gt;');
  });
});
