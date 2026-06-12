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
    identitySections: [{ title: 'Core Role', lines: ['General-purpose personal assistant'] }],
    soulSections: [{ title: 'Vibe', lines: ['Concise by default. Walls of text are a crime.'] }]
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
    details: [
      { name: 'sync', description: 'End-to-end refresh of every derived view.', custom: false, auto: false },
      { name: 'status', description: 'Command-center overview of the whole agent.', custom: false, auto: true }
    ]
  },
  mcp: {
    toolCount: 2,
    toolDetails: [
      { name: 'mcp__kevin__dashboard', description: 'Rebuild TASKS.md + the Agent OS dashboard.' },
      { name: 'mcp__kevin__task_scan', description: 'Resolve cross-task state.' }
    ]
  },
  goals: {
    weekly: [],
    monthly: ['Ship the MD Status application'],
    yearly: ['Q3: land MD Status; Q4: first customer']
  },
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
      time: '09:12',
      turns: 13,
      cwd: '~/Documents/Agents/Kevin',
      briefing: 'Morning sync and MDEC portal work',
      isCommand: false
    },
    {
      id: 'cmd00001',
      firstSeen: '2026-06-11',
      lastSeen: '2026-06-11',
      time: '09:45',
      turns: 4,
      cwd: '/tmp/elsewhere',
      briefing: '/agent-kevin:sync morning',
      isCommand: true
    }
  ],
  news: [
    {
      date: '2026-06-11',
      title: 'Claude Fable 5 released',
      url: 'https://example.com/fable',
      source: 'Anthropic, Jun 9'
    },
    {
      date: '2026-06-11',
      title: 'NEEP Category-I EP salary RM20K/mo confirmed',
      url: '',
      source: 'MOHA, Jun 9'
    }
  ],
  lint: {
    date: '2026-06-11T09:02:20+08:00',
    errors: 0,
    warnings: 1,
    suggestions: 2,
    issues: [{ severity: 'WARNING', text: 'memory/2026-06-07.md is sparse' }],
    present: true
  },
  cli: [
    {
      section: 'Groups',
      entries: [{ cmd: 'status', desc: 'Rebuild the Agent OS dashboard at <HOME>/dashboard.html' }]
    }
  ],
  hooks: { count: 1, entries: [{ event: 'SessionStart', command: 'kevin session-start' }] },
  knowledge: {
    concepts: 1,
    conceptDetails: [
      {
        name: 'flywheel-model',
        description: 'Projects cross-pollinate into deeper skills',
        href: 'knowledge/concepts/flywheel-model.md'
      }
    ],
    facets: [{ name: 'profile', bytes: 1024 }],
    memoryDaily: 3,
    memoryIndexBytes: 2048,
    activeThreads: 2,
    learnings: 4,
    inboxItems: 0,
    feedbackBytes: 512,
    totalBytes: 100_000,
    sessionsWeek: [
      { label: 'Fri', bytes: 0 },
      { label: 'Sat', bytes: 100 },
      { label: 'Sun', bytes: 0 },
      { label: 'Mon', bytes: 2000 },
      { label: 'Tue', bytes: 300 },
      { label: 'Wed', bytes: 0 },
      { label: 'Thu', bytes: 50 }
    ]
  },
  compile: {
    ingested: 10,
    sessionFiles: 10,
    pending: 0,
    lastCompiled: '2026-06-11T01:00:00Z',
    totalCostUsd: 1.23
  },
  tasks: {
    active: 1,
    blocked: 1,
    stale: 0,
    overdue: 0,
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
    layers: [
      { label: 'project', path: '/tmp/home/.claude/settings.json', present: true, allow: 5, deny: 1, envCount: 1 }
    ],
    allow: 5,
    deny: 1,
    env: [{ key: 'KEVIN_API_KEY', value: '••••abcd', scope: 'workspace' }],
    enabledPlugins: ['agent-kevin@agentlayer'],
    plugin: { ref: 'agent-kevin@agentlayer', marketplace: 'agentlayer', sourceType: 'github', sourcePath: 'a/b' }
  },
  logs: {
    path: '/tmp/home/.kevin/logs/app.log',
    bytes: 1000,
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
  health: { overdue: 0, pendingCompiles: 0, logErrors: 0, missingImports: 0, ok: true },
  ...overrides
});

describe('renderDashboardHtml', () => {
  test('renders every page, nav items for visible ones, and one document shell', () => {
    const html = renderDashboardHtml(makeSnapshot());
    for (const item of PAGES) {
      expect(html).toContain(`data-page="${item.id}"`);
      // Hidden pages get no sidebar item (profile routes via the operator card).
      const hasNavItem = html.includes(`class="nav-item" data-nav="${item.id}"`);
      expect(hasNavItem).toBe(!('hidden' in item && item.hidden));
    }
    expect(html.match(/<!doctype html>/g)?.length).toBe(1);
    // Healthy snapshots show the green badge; it routes to the Status page.
    expect(html).toContain('class="badge ok" data-nav="status"');
    expect(html).toContain('all nominal');
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
    expect(html).toContain('<div class="tname">dashboard</div>');
    expect(html).toContain('Rebuild TASKS.md + the Agent OS dashboard.');
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

  test('loads zero external resources; outbound links open new tabs', () => {
    const html = renderDashboardHtml(makeSnapshot());
    // No auto-loaded remote resources — scripts, stylesheets, images, fonts.
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link [^>]*href="https?:/);
    expect(html).not.toMatch(/src="https?:/);
    expect(html).not.toMatch(/url\(\s*['"]?https?:/);
    expect(html).not.toMatch(/@import/);
    // Every external anchor (news, profile links) opens in a new tab.
    const external = html.match(/<a [^>]*href="https?:[^>]*>/g) ?? [];
    expect(external.length).toBeGreaterThan(0);
    external.forEach((anchor) => expect(anchor).toContain('target="_blank"'));
  });

  test('today carries goals, news, and the commands feed', () => {
    const html = renderDashboardHtml(makeSnapshot());
    expect(html).toContain('Q3: land MD Status; Q4: first customer');
    expect(html).toContain('href="https://example.com/fable"');
    // Link-less headlines render as plain text, never as empty anchors.
    expect(html).toContain('NEEP Category-I EP salary RM20K/mo confirmed');
    expect(html).not.toContain('href=""');
    expect(html).toContain('⚡ Commands · 1');
    expect(html).toContain('💬 Sessions · 1');
  });

  test('unset goals show the run-the-skill hint', () => {
    const html = renderDashboardHtml(makeSnapshot());
    expect(html).toContain('No weekly goals set yet, run the weekly-goals skill.');
  });

  test('today feed spans the last 24h: yesterday in, two days ago out', () => {
    const base = makeSnapshot();
    const html = renderDashboardHtml(
      makeSnapshot({
        sessions: [
          ...base.sessions,
          {
            id: 'late00001',
            firstSeen: '2026-06-10',
            lastSeen: '2026-06-10',
            time: '23:40',
            turns: 7,
            cwd: '~/Documents/Agents/Kevin',
            briefing: 'Late-night portal fixes',
            isCommand: false
          },
          {
            id: 'old000001',
            firstSeen: '2026-06-09',
            lastSeen: '2026-06-09',
            time: '',
            turns: 3,
            cwd: '~/Documents/Agents/Kevin',
            briefing: 'Two-days-ago session',
            isCommand: false
          }
        ]
      })
    );
    const today = html.slice(html.indexOf('data-page="today"'), html.indexOf('data-page="tasks"'));
    expect(today).toContain('Late-night portal fixes');
    expect(today).not.toContain('Two-days-ago session');
    // Feed rows carry timestamps; yesterday's rows wear a stacked day label
    // under the time so times stay column-aligned.
    expect(today).toContain('09:12');
    expect(today).toContain('23:40<span style="display:block;font-size:10px">yesterday</span>');
  });

  test('resumed sessions wear a since-chip explaining their old briefing', () => {
    const base = makeSnapshot();
    const html = renderDashboardHtml(
      makeSnapshot({
        sessions: [
          ...base.sessions,
          {
            id: 'longrun01',
            firstSeen: '2026-05-28',
            lastSeen: '2026-06-11',
            time: '08:02',
            turns: 405,
            cwd: '~/Documents/Agents/Kevin',
            briefing: 'A briefing from two weeks ago',
            isCommand: false
          }
        ]
      })
    );
    expect(html).toContain('↩ since 2026-05-28');
  });

  test('persona interleaves identity and soul sections, identity first', () => {
    const html = renderDashboardHtml(makeSnapshot());
    const personaPage = html.slice(html.indexOf('data-page="persona"'), html.indexOf('data-page="system"'));
    expect(personaPage.indexOf('Core Role')).toBeGreaterThan(-1);
    expect(personaPage.indexOf('Core Role')).toBeLessThan(personaPage.indexOf('>Vibe<'));
    expect(personaPage).toContain('>Files<');
    expect(personaPage).not.toContain('Identity files');
  });

  test('brain lint tab and capabilities commands tab render', () => {
    const html = renderDashboardHtml(makeSnapshot());
    expect(html).toContain('memory/2026-06-07.md is sparse');
    expect(html).toContain('Rebuild the Agent OS dashboard at &lt;HOME&gt;/dashboard.html');
    expect(html).toContain('class="chip auto"');
  });

  test('sessions page drops command sessions and groups by day', () => {
    const html = renderDashboardHtml(makeSnapshot());
    const sessions = html.slice(html.indexOf('data-page="sessions"'), html.indexOf('data-page="brain"'));
    expect(sessions).toContain('Morning sync and MDEC portal work');
    expect(sessions).not.toContain('agent-kevin:sync morning');
    expect(sessions).toContain('13 turns');
  });

  test('unhealthy snapshot names the issues and routes to the status page', () => {
    const base = makeSnapshot();
    const html = renderDashboardHtml(
      makeSnapshot({
        tasks: { ...base.tasks, overdue: 2, overdueList: [taskRef(), taskRef({ id: 'lo-009' })] },
        health: { overdue: 2, pendingCompiles: 1, logErrors: 0, missingImports: 0, ok: false }
      })
    );
    expect(html).toContain('class="badge warn" data-nav="status"');
    expect(html).toContain('2 overdue · 1 pending');
    const status = html.slice(html.indexOf('data-page="status"'));
    expect(status).toContain('2 signal(s) need attention');
    expect(status).toContain('lo-009');
  });

  test('status page explains every signal with derivations and jump links', () => {
    const base = makeSnapshot();
    const html = renderDashboardHtml(makeSnapshot({ tasks: { ...base.tasks, stale: 3 } }));
    const status = html.slice(html.indexOf('data-page="status"'));
    expect(status).toContain('All systems nominal');
    expect(status).toContain('Nothing past due.');
    expect(status).toContain('Everything captured has been compiled.');
    expect(status).toContain('No errors logged today.');
    expect(status).toContain('All static imports present.');
    expect(status).toContain('data-nav="system/logs"');
    // Stale is informational: linked for review but never trips the badge.
    expect(status).toContain('data-nav="tasks/attention"');
    expect(html).toContain('class="badge ok"');
    // Hidden page: routes but earns no sidebar item.
    expect(html).not.toContain('class="nav-item" data-nav="status"');
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
