import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FOLDERS } from '@/config';
import type { TaskFile, TaskFrontmatter } from '@/shared/types';
import { roadmapDataBlock } from '@/roadmap/data';
import { todayDate } from '@/shared/date';
import { collectStatus } from './collect';
import { buildFocusView, focusPagePath, writeFocusPage, writeFocusPagesSafe, type FocusInputs } from './focus';
import { focusData, readFocusData } from './focus-data';
import { renderFocusHtml } from './focus-render';

const TODAY = '2026-09-28';

const task = (id: string, overrides: Partial<TaskFrontmatter> = {}): TaskFile => ({
  frontmatter: {
    schema: 1,
    id,
    title: `Task ${id}`,
    type: 'task',
    status: 'active',
    priority: 'P2',
    project: 'acme',
    assignee: ['user'],
    labels: [],
    created: '2026-09-01',
    updated: '2026-09-01',
    due: '',
    horizon: '',
    depends_on: [],
    blocked_by: '',
    parent: '',
    closed: '',
    ...overrides
  },
  description: '',
  checklist: [],
  thread: [],
  filePath: `/home/alex/projects/acme/tasks/${id}.md`
});

const inputs = (tasks: TaskFile[], overrides: Partial<FocusInputs> = {}): FocusInputs => ({
  project: '',
  home: '/home/alex',
  tasks,
  goals: { weekly: ['Ship the invoice export'], monthly: [] },
  roadmaps: [],
  snapshot: null,
  self: new Set(['user', 'alex']),
  operator: 'Alex Chen',
  today: TODAY,
  generatedAt: '09:12',
  markdownUrl: 'obsidian://open?path={path}',
  timeZone: 'UTC',
  ...overrides
});

describe('buildFocusView', () => {
  const view = buildFocusView(
    inputs([
      task('ac-001', { horizon: TODAY, priority: 'P1' }),
      task('ac-002', { horizon: TODAY, priority: 'P0' }),
      task('ac-003', { horizon: '2026-09-25' }),
      task('ac-004', { horizon: '2026-W40', status: 'done' }),
      task('ac-005', { horizon: '2026-W39', status: 'done' }),
      task('ac-006', { horizon: '2026-W40', assignee: ['kevin'] }),
      task('ac-007', { assignee: [] }),
      task('ac-008', { horizon: 'later', status: 'cancelled' })
    ])
  );

  test('today is ordered by priority and past plans are carried over', () => {
    expect(view.lanes.today.map((item) => item.id)).toEqual(['ac-002', 'ac-001']);
    expect(view.lanes.carried.map((item) => item.id)).toEqual(['ac-003']);
  });

  test('done work counts only inside a current period', () => {
    expect(view.done.week.map((item) => item.id)).toEqual(['ac-004']);
    expect(view.lanes.carried.map((item) => item.id)).not.toContain('ac-005');
  });

  test("a teammate's task stays off the page; an unassigned one is mine but unplanned", () => {
    expect(view.lanes.week).toEqual([]);
    expect(view.unplanned.map((item) => item.id)).toEqual(['ac-007']);
    expect(view.lanes.later).toEqual([]);
  });
});

describe('week and month progress', () => {
  const view = buildFocusView(
    inputs([
      task('ac-001', { horizon: TODAY, status: 'done' }),
      task('ac-002', { horizon: TODAY }),
      task('ac-003', { horizon: '2026-W40', status: 'done' }),
      task('ac-004', { horizon: '2026-W40', status: 'cancelled' }),
      task('ac-005', { horizon: '2026-09' })
    ])
  );

  test("work pulled into today still counts toward the week and month it belongs to", () => {
    expect(view.planned.week.done.map((item) => item.id)).toEqual(['ac-001', 'ac-003']);
    expect(view.planned.week.open.map((item) => item.id)).toEqual(['ac-002']);
    expect(view.planned.month.open.map((item) => item.id)).toEqual(['ac-005', 'ac-002']);
    expect(renderFocusHtml(view)).toContain('<b>2/3</b> this week');
  });
});

describe('renderFocusHtml', () => {
  test('titles are escaped, the data block stays inert, and the page makes no external requests', () => {
    const title = '<img src=x onerror=alert(1)></script><script>alert(2)</script>';
    const view = buildFocusView(inputs([task('ac-001', { horizon: TODAY, title })]));
    const html = renderFocusHtml(view);
    const rendered = html.replace(/<script type="application\/json" id="focus-data">[\s\S]*?<\/script>/, '');
    expect(rendered).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(rendered).not.toContain('<img');
    expect(rendered).not.toContain('<script');
    expect(html.match(/<\/script/gi)).toEqual(['</script']);
    expect(readFocusData(html)?.lanes.today[0].title).toBe(title);
    expect(html).not.toMatch(/(src|href)="https?:/);
    expect(html).not.toMatch(/url\(["']?https?:/);
  });

  test('the page embeds its data with task paths relative to the home', () => {
    const view = buildFocusView(inputs([task('ac-001', { horizon: TODAY })]));
    const data = readFocusData(renderFocusHtml(view));
    expect(data).toEqual(focusData(view));
    expect(data?.lanes.today[0].path).toBe('projects/acme/tasks/ac-001.md');
    expect(JSON.stringify(data)).not.toContain('/home/alex');
  });

  test('today reads as a numbered list with the date as the headline', () => {
    const html = renderFocusHtml(buildFocusView(inputs([task('ac-001', { horizon: TODAY })])));
    expect(html).toContain('<em>Monday</em>, 28 September');
    expect(html).toContain('<span class="mark">1</span><span class="title">Task ac-001</span>');
    expect(html).toContain(`href="obsidian://open?path=${encodeURIComponent('/home/alex/projects/acme/tasks/ac-001.md')}"`);
  });

  test('without a pull the queue says how to get one; with one it lists each item and when it was pulled', () => {
    expect(renderFocusHtml(buildFocusView(inputs([])))).toContain('No pull yet');
    const fetchedAt = '2026-09-28T09:47:00Z';
    const html = renderFocusHtml(
      buildFocusView(
        inputs([], {
          snapshot: {
            fetchedAt,
            groups: [
              {
                label: 'My pull requests',
                empty: 'None open.',
                items: [{ title: '#42 Invoice export', url: 'https://github.com/acme/app/pull/42', detail: 'approved · clean', tone: 'good' }],
                unavailable: ''
              },
              { label: 'Reviews I owe', empty: 'Nothing waiting on you.', items: [], unavailable: '' },
              {
                label: 'Replies I owe',
                empty: 'Inbox clear.',
                items: [{ title: 'Jordan asked about the export date', url: '', detail: '#support · 2d', tone: 'warn' }],
                unavailable: ''
              }
            ]
          }
        })
      )
    );
    expect(html).toContain('queue pulled 09:47');
    expect(html).toContain('<a href="https://github.com/acme/app/pull/42" target="_blank" rel="noopener">#42 Invoice export</a>');
    expect(html).toContain('Nothing waiting on you.');
    expect(html).toContain('<span class="dot warn"></span>');
  });
});

describe('queue sources that could not be read', () => {
  test('say so once per group and are never counted as items', () => {
    const view = buildFocusView(
      inputs([], {
        snapshot: {
          fetchedAt: '2026-09-27T23:10:00Z',
          groups: [
            { label: 'My pull requests', empty: 'None open.', items: [], unavailable: "GitHub can't read 2 repos: web, ops" },
            {
              label: 'Reviews I owe',
              empty: 'Nothing waiting on you.',
              items: [{ title: '#7 Retry policy', url: '', detail: 'sam · 1d', tone: 'warn' }],
              unavailable: ''
            }
          ]
        }
      })
    );
    const html = renderFocusHtml(view).replace(/<script type="application\/json"[\s\S]*<\/script>/, '');
    expect(html).toContain('<p class="unavailable">GitHub can&#39;t read 2 repos: web, ops</p>');
    expect(html).not.toContain('None open.');
    expect(html).toMatch(/<h2>Queue<\/h2><span class="count">1<\/span>/);
    expect(view.queuePulled).toBe('Sun 27 · 23:10');
  });
});

describe('due work with no plan', () => {
  test('leaves the collapsed lanes and shows under Today', () => {
    const view = buildFocusView(
      inputs([
        task('ac-001', { due: '2026-09-20' }),
        task('ac-002', { due: TODAY, horizon: 'later' }),
        task('ac-003', { due: '2026-10-09' }),
        task('ac-004', { due: '2026-09-20', horizon: '2026-W40' })
      ])
    );
    expect(view.dueUnplanned.map((item) => item.id)).toEqual(['ac-001', 'ac-002']);
    expect(view.unplanned.map((item) => item.id)).toEqual(['ac-003']);
    expect(view.lanes.later).toEqual([]);
    expect(view.lanes.week.map((item) => item.id)).toEqual(['ac-004']);
    expect(renderFocusHtml(view)).toContain('<h3>Due, not planned · 2</h3>');
  });
});

describe('roadmap milestones', () => {
  const roadmap = {
    q4: {
      title: 'Q4',
      periods: [
        {
          name: 'Late Sep',
          start: '2026-09-21',
          end: '2026-09-27',
          milestones: [{ chip: 'M1', title: 'Slipped', items: [{ text: 'Ledger (ac-001)', status: 'progress' }] }]
        },
        {
          name: 'This week',
          start: '2026-W40',
          milestones: [
            { chip: 'M2', title: 'Current', items: [{ text: 'Export', status: 'planned' }, { text: 'Import', status: 'done' }] },
            { chip: 'M3', title: 'Finished', items: [{ text: 'Keys', status: 'done' }] }
          ]
        },
        { name: 'Next', start: '2026-10', milestones: [{ chip: 'M4', title: 'Future', items: [{ text: 'Later', status: 'planned' }] }] }
      ]
    },
    horizon: { cards: [{ theme: 'Undated but moving', items: [{ text: '<b>Docs</b> (op-001)', status: 'progress' }] }] }
  };
  const view = buildFocusView(
    inputs([task('ac-001', { horizon: TODAY }), task('op-001', { project: 'ops', status: 'done' })], {
      roadmaps: [
        { source: 'roadmap.html', read: { kind: 'data', raw: '', data: roadmap }, linkedOnly: false },
        { source: 'projects/web/roadmap.html', read: { kind: 'legacy' }, linkedOnly: false }
      ]
    })
  );

  test('slipped windows lead, then in-progress or current ones; finished and future ones stay off', () => {
    expect(view.roadmap.milestones.map((item) => [item.chip || item.title, item.state])).toEqual([
      ['M1', 'slipped'],
      ['M2', 'now'],
      ['Undated but moving', 'now']
    ]);
  });

  test('task ids in the text link tasks, and a milestone no open task names is a gap', () => {
    const [slipped, current, undated] = view.roadmap.milestones;
    expect(slipped.tasks.map((item) => item.id)).toEqual(['ac-001']);
    expect(slipped.gap).toBe(false);
    expect(current.gap).toBe(true);
    expect(undated).toMatchObject({ inProgress: ['Docs (op-001)'], gap: true, done: 0, total: 1 });
  });

  test('an unmigrated roadmap says so, and the page shows the section', () => {
    expect(view.roadmap.notices).toEqual([
      "projects/web/roadmap.html still keeps its data in a script, so it can't feed this page yet: ask /roadmap to convert it."
    ]);
    const html = renderFocusHtml(view);
    expect(html).toContain('<span class="chip">M1</span>Slipped');
    expect(html).toContain('window ended 27 Sep');
    expect(html).toContain('no open task behind it');
    expect(html).toContain('ac-001</a> today');
  });

  test('a project page keeps only the root milestones that name its tasks, and notes an undated roadmap', () => {
    const project = buildFocusView(
      inputs([task('ac-001', { horizon: TODAY }), task('op-001', { project: 'ops' })], {
        project: 'ops',
        roadmaps: [
          { source: 'projects/ops/roadmap.html', read: { kind: 'data', raw: '', data: { a: { items: [{ text: 'x', status: 'planned' }] } } }, linkedOnly: false },
          { source: 'roadmap.html', read: { kind: 'data', raw: '', data: roadmap }, linkedOnly: true }
        ]
      })
    );
    expect(project.roadmap.milestones.map((item) => item.title)).toEqual(['Undated but moving']);
    expect(project.roadmap.notices).toEqual([
      'projects/ops/roadmap.html has no dates, so only its in-progress items show here. /roadmap can date it.',
      "projects/ops/roadmap.html names no task ids, so focus can't tell which tasks move its milestones. /roadmap can add them."
    ]);
  });

  test('a roadmap that names no task ids flags no gaps, and says so once', () => {
    const view = buildFocusView(
      inputs([], {
        roadmaps: [
          {
            source: 'roadmap.html',
            read: { kind: 'data', raw: '', data: { s: { start: '2026-09', items: [{ text: 'Docs', status: 'progress' }] } } },
            linkedOnly: false
          }
        ]
      })
    );
    expect(view.roadmap.milestones.map((item) => item.gap)).toEqual([false]);
    expect(view.roadmap.notices).toEqual([
      "roadmap.html names no task ids, so focus can't tell which tasks move its milestones. /roadmap can add them."
    ]);
  });
});

describe('project page', () => {
  const view = buildFocusView(
    inputs([task('ac-001', { horizon: TODAY }), task('op-001', { horizon: TODAY, project: 'ops' })], { project: 'acme' })
  );

  test('holds only its project, names it, and leaves the home-wide goals off', () => {
    expect(view.lanes.today.map((item) => item.id)).toEqual(['ac-001']);
    expect(view.weekGoals).toEqual([]);
    const html = renderFocusHtml(view);
    expect(html).toContain('<div class="kicker">Focus · Acme</div>');
    expect(html).toContain('<code>/focus plan acme</code>');
    expect(html).not.toContain('class="proj"');
  });

  test('a pull with no groups hides the queue', () => {
    const html = renderFocusHtml({ ...view, snapshot: { fetchedAt: new Date().toISOString(), groups: [] } });
    expect(html).not.toContain('Queue');
  });
});

describe('focus pages on disk', () => {
  test('only project pages the skill created re-render, a project dashboard.html is never touched, and none is a surface', async () => {
    mkdirSync(join(FOLDERS.PROJECTS, 'acme', 'tasks'), { recursive: true });
    const dashboard = join(FOLDERS.PROJECTS, 'acme', 'dashboard.html');
    writeFileSync(dashboard, '<p>hand-made</p>');
    const page = focusPagePath('acme');
    rmSync(page, { force: true });
    writeFocusPagesSafe();
    expect(existsSync(page)).toBe(false);
    expect(existsSync(join(FOLDERS.HOME, 'focus.html'))).toBe(false);

    writeFocusPage('acme');
    const archived = join(FOLDERS.PROJECTS, 'acme', 'tasks', 'archive');
    mkdirSync(archived, { recursive: true });
    writeFileSync(
      join(archived, 'ac-901-shipped.md'),
      `---\nschema: 1\nid: ac-901\ntitle: Shipped already\ntype: task\nstatus: done\npriority: P2\nproject: acme\nassignee: [user]\nlabels: []\ncreated: ${todayDate()}\nupdated: ${todayDate()}\ndue: ''\nhorizon: ${todayDate()}\ndepends_on: []\nblocked_by: ''\nparent: ''\nclosed: ${todayDate()}\n---\n\n## Description\n\nDone.\n`
    );
    writeFocusPagesSafe();
    expect(readFileSync(page, 'utf-8')).toContain('Shipped already');
    expect(existsSync(join(FOLDERS.HOME, 'focus.html'))).toBe(false);
    expect(readFileSync(dashboard, 'utf-8')).toBe('<p>hand-made</p>');
    rmSync(join(archived, 'ac-901-shipped.md'), { force: true });

    const { surfaces, tasks, focus } = await collectStatus();
    expect(surfaces.map((surface) => surface.title)).not.toContain('Focus');
    expect(focus.project).toBe('');
    expect(surfaces).toContainEqual({ title: 'Acme', icon: '📊', appTab: false, href: 'projects/acme/dashboard.html' });
    expect(surfaces.map((surface) => surface.href)).not.toContain('projects/acme/focus.html');
    expect(tasks.byProject.find((load) => load.project === 'acme')?.focus).toBe('projects/acme/focus.html');

    [page, dashboard].forEach((path) => rmSync(path, { force: true }));
  });

  test("a project page reads its own roadmap, and the root's legacy page adds no notice there", () => {
    mkdirSync(join(FOLDERS.PROJECTS, 'acme', 'tasks'), { recursive: true });
    const own = join(FOLDERS.PROJECTS, 'acme', 'roadmap.html');
    const root = join(FOLDERS.HOME, 'roadmap.html');
    writeFileSync(own, `<body>${roadmapDataBlock({ a: { title: 'Lane', items: [{ text: 'Invoice export', status: 'progress' }] } })}</body>`);
    writeFileSync(root, '<script>const ROADMAP = { a: 1 };</script>');
    const { view } = writeFocusPage('acme');
    expect(view.roadmap).toMatchObject({
      milestones: [{ title: 'Lane', source: 'projects/acme/roadmap.html' }],
      notices: [
        'projects/acme/roadmap.html has no dates, so only its in-progress items show here. /roadmap can date it.',
        "projects/acme/roadmap.html names no task ids, so focus can't tell which tasks move its milestones. /roadmap can add them."
      ]
    });
    expect(readFileSync(focusPagePath('acme'), 'utf-8')).toContain('⏳ Invoice export');
    [own, root, focusPagePath('acme')].forEach((path) => rmSync(path, { force: true }));
  });

  test('the home scope has no page of its own; it lives in the dashboard', () => {
    expect(() => focusPagePath('')).toThrow('lives in the dashboard');
    expect(() => writeFocusPage('')).toThrow('lives in the dashboard');
  });

  test('a slug that is not a project folder is refused before it becomes a path', () => {
    expect(() => focusPagePath('../..')).toThrow('Unknown project');
    expect(() => writeFocusPage('nope')).toThrow('Unknown project');
  });
});
