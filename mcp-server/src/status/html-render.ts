/**
 * Fills dashboard.html with a StatusSnapshot — the Agent OS dashboard at
 * `<HOME>/index.html`.
 *
 * Life-OS framing: a left sidebar (Kevin's wordmark + pages + operator card)
 * and operator-first pages — Today, Work, Sessions, Brain, Reports,
 * Capabilities, Profile (the operator), Persona (Kevin), System.
 *
 * Markdown links open through a configurable app URL template (obsidian://
 * by default, e.g. markedit:// via the MARKDOWN_URL env var) so tasks,
 * reports, concepts, and memory files open rendered and editable instead of
 * downloading as raw text. Projects carry a stable hash-derived color across
 * every badge.
 *
 * Pure presentation: collect.ts owns every disk read, dashboard.html owns all
 * CSS/JS, html.ts owns the write. Every snapshot-derived string passes through
 * esc(). Secrets arrive pre-redacted from collect.ts.
 *
 * Import discipline: runtime imports here must stay config-free (type-only
 * imports are fine) so html.test.ts can import this module without freezing
 * @/config's KEVIN_HOME for the rest of the bun test process. The template is
 * plugin-static, read relative to this file — not HOME state.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import type { ManifestEntry } from '@/context';
import { BANNER_LINES, BANNER_TAG } from '@/shared/banner';
import type { ContextGroup, ProjectLoad, ReportRef, StatusSnapshot, TaskRef } from './collect';
import { humanBytes, relTime, shortToolName, tildifyHome, truncate } from './format';

const TEMPLATE = readFileSync(new URL('dashboard.html', import.meta.url), 'utf-8');

/** `hidden` pages render and route but stay out of the sidebar — the
 *  Profile page is reached through the operator card instead. */
export const PAGES = [
  { id: 'today', icon: '☀️', label: 'Today' },
  { id: 'tasks', icon: '✅', label: 'Tasks' },
  { id: 'projects', icon: '📂', label: 'Projects' },
  { id: 'sessions', icon: '💬', label: 'Sessions' },
  { id: 'brain', icon: '🧠', label: 'Brain' },
  { id: 'reports', icon: '📰', label: 'Reports' },
  { id: 'capabilities', icon: '🧩', label: 'Capabilities' },
  { id: 'profile', icon: '👤', label: 'Profile', hidden: true },
  { id: 'persona', icon: '🍌', label: 'Persona' },
  { id: 'system', icon: '⚙️', label: 'System' }
] as const;

export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const esc = escapeHtml;

// ── small primitives ──────────────────────────────────────────────────

/** Link a markdown file (absolute path) through the configured opener app
 *  (obsidian:// by default; e.g. markedit:// via the MARKDOWN_URL env var).
 *  `cls: 'plink'` keeps the surrounding text color, underlining on hover. */
const mdLinkAbs = (snap: StatusSnapshot, absPath: string, text: string, cls = ''): string =>
  `<a${cls ? ` class="${cls}"` : ''} href="${esc(snap.markdownUrl.replace('{path}', encodeURIComponent(absPath)))}">${esc(text)}</a>`;

/** Same, for a path relative to <HOME> (`~/...` resolves to the OS home). */
const mdLink = (snap: StatusSnapshot, rel: string, text: string, cls = ''): string =>
  mdLinkAbs(snap, rel.startsWith('~/') ? rel.replace('~', homedir()) : `${snap.runtime.home}/${rel}`, text, cls);

/** Filesystem location link: `file://` href, inherits the surrounding color,
 *  underlines only on hover (Safari opens directories straight in Finder).
 *  Accepts `~/...` paths and expands them against the OS home. */
const pathLink = (path: string, cls = 'plink'): string => {
  const abs = path.startsWith('~') ? path.replace('~', homedir()) : path;
  return `<a class="${cls}" href="file://${esc(encodeURI(abs))}">${esc(tildifyHome(abs))}</a>`;
};

/** Stable per-project hue so a project's badge color survives regeneration. */
const projectColor = (name: string): string => {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) % 360;
  return `hsl(${hash}, 55%, 62%)`;
};

const projChip = (name: string): string =>
  `<span class="chip proj"><i style="background:${projectColor(name)}"></i>${esc(name)}</span>`;

/** External web link — opens in a new tab. */
const extLink = (url: string, text: string): string =>
  `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>`;

/** Escape text and turn embedded http(s) URLs into new-tab links. */
const linkify = (text: string): string =>
  text
    .split(/(https?:\/\/[^\s)]+)/)
    .map((part, index) => (index % 2 === 1 ? extLink(part, part.replace(/^https?:\/\/(www\.)?/, '')) : esc(part)))
    .join('');

const section = (title: string, right: string, body: string): string =>
  `<div class="section"><h2>${esc(title)}<i></i>${right ? `<span class="right">${esc(right)}</span>` : ''}</h2>${body}</div>`;

const hint = (text: string): string => `<div class="hint">${esc(text)}</div>`;

const stat = (num: number | string, label: string, cls = ''): string =>
  `<div class="stat"><div class="num ${cls}">${esc(String(num))}</div><div class="lab">${esc(label)}</div></div>`;

const statStrip = (stats: string[]): string => `<div class="statstrip">${stats.join('')}</div>`;

const flexBar = (segments: Array<{ value: number; color: string }>): string =>
  `<div class="flexbar">${segments
    .filter((segment) => segment.value > 0)
    .map((segment) => `<span style="flex-grow:${segment.value};background:${segment.color}"></span>`)
    .join('')}</div>`;

const legend = (items: Array<{ label: string; color: string }>): string =>
  `<div class="legend">${items
    .map((item) => `<span><i style="background:${item.color}"></i>${esc(item.label)}</span>`)
    .join('')}</div>`;

const table = (headers: string[], rows: string[][], rowAttr = ''): string => {
  const head = headers.some(Boolean) ? `<tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>` : '';
  const body = rows.map((row) => `<tr${rowAttr}>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('');
  return `<table>${head}${body}</table>`;
};

const filterInput = (placeholder: string): string =>
  `<input class="filter" type="search" placeholder="${esc(placeholder)}">`;

interface SubTab {
  id: string;
  label: string;
  body: string;
}

const subTabs = (tabs: SubTab[]): string => {
  const buttons = tabs
    .map(
      (tab, index) =>
        `<button class="subtab${index === 0 ? ' active' : ''}" data-subtab="${esc(tab.id)}">${esc(tab.label)}</button>`
    )
    .join('');
  const panels = tabs
    .map((tab, index) => `<div data-subpanel="${esc(tab.id)}"${index === 0 ? ' class="active"' : ''}>${tab.body}</div>`)
    .join('');
  return `<div data-tabgroup><div class="subtabs">${buttons}</div>${panels}</div>`;
};

const page = (id: string, titleHtml: string, sub: string, body: string): string =>
  `<section class="page" data-page="${id}"><h1>${titleHtml}</h1><p class="sub">${esc(sub)}</p>${body}</section>`;

const plainRows = (items: string[], emptyText: string): string =>
  items.length
    ? items.map((item) => `<div class="row" data-row><span class="grow">${esc(item)}</span></div>`).join('')
    : hint(emptyText);

// ── dates ─────────────────────────────────────────────────────────────

/** Days from `fromIso` to `toIso`; both YYYY-MM-DD. NaN-safe → 0. */
const daysBetween = (fromIso: string, toIso: string): number => {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
};

const dueLabel = (due: string, todayIso: string): { text: string; cls: string } => {
  if (!due) return { text: '', cls: '' };
  const days = daysBetween(todayIso, due);
  if (days < 0) return { text: `${-days}d overdue`, cls: 'bad' };
  if (days === 0) return { text: 'due today', cls: 'warn' };
  if (days <= 7) return { text: `due in ${days}d`, cls: 'warn' };
  return { text: `due ${due}`, cls: '' };
};

// ── tasks ─────────────────────────────────────────────────────────────

interface TaskRowOptions {
  /** Hide the project chip (redundant inside a single-project view). */
  noProject?: boolean;
}

/** Expandable task row: linked id · title · project · due badge · priority. */
const taskRow = (ref: TaskRef, snap: StatusSnapshot, options: TaskRowOptions = {}): string => {
  const todayIso = snap.runtime.isoDate;
  const due = dueLabel(ref.due, todayIso);
  const dueHtml = due.text ? `<span class="meta ${due.cls}">${esc(due.text)}</span>` : '';
  const details = [
    `project ${ref.project}`,
    `status ${ref.status}`,
    ref.due && `due ${ref.due}`,
    ref.updated && `updated ${ref.updated}`,
    ref.dependsOn.length && `depends on ${ref.dependsOn.join(', ')}`,
    ref.blockedBy && `blocked by: ${ref.blockedBy}`
  ].filter((part): part is string => Boolean(part));
  const open = ref.path ? ` · ${mdLink(snap, ref.path, 'open file')}` : '';
  return `<details class="task" data-row><summary><span class="tid nowrap">${
    ref.path ? mdLink(snap, ref.path, ref.id) : esc(ref.id)
  }</span><span class="ttl">${esc(ref.title)}</span>${options.noProject ? '' : projChip(ref.project)}${dueHtml}<span class="pri ${esc(
    ref.priority.toLowerCase()
  )}">${esc(ref.priority)}</span></summary><div class="taskbody">${esc(details.join(' · '))}${open}</div></details>`;
};

const taskGroup = (
  title: string,
  refs: TaskRef[],
  snap: StatusSnapshot,
  issue = false,
  options: TaskRowOptions = {}
): string =>
  refs.length
    ? `<h3 class="group"${issue ? ' data-issue' : ''}>${esc(title)} · ${refs.length}</h3>${refs
        .map((ref) => taskRow(ref, snap, options))
        .join('')}`
    : '';

// ── pages ─────────────────────────────────────────────────────────────

const reportRow = (report: ReportRef, snap: StatusSnapshot): string => {
  const title = report.href ? mdLink(snap, report.href, report.title) : esc(report.title);
  return `<div class="row" data-row><span class="dim" style="flex:none">${esc(report.time)}</span><span style="flex:none">${esc(
    report.status
  )}</span><span class="grow">${title}</span>${report.skill ? projChip(report.skill) : ''}</div>`;
};

const pageToday = (snap: StatusSnapshot): string => {
  const { tasks, runtime, compile, knowledge, goals, health } = snap;
  const today = runtime.isoDate;
  const hour = parseInt(runtime.time.slice(0, 2), 10) || 0;
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const name = snap.operator.name ? `, ${esc(snap.operator.name)}` : '';

  const dueToday = tasks.queue.filter((ref) => ref.due === today && ref.status !== 'blocked');
  const dueWeek = tasks.queue.filter((ref) => {
    if (!ref.due) return false;
    const days = daysBetween(today, ref.due);
    return days > 0 && days <= 7;
  });
  const overdueIds = new Set(tasks.overdueList.map((ref) => ref.id));
  const active = tasks.activeList.filter((ref) => !overdueIds.has(ref.id) && ref.due !== today);
  const blocked = tasks.queue.filter((ref) => ref.status === 'blocked' && ref.blockedBy);

  const stats = statStrip([
    stat(tasks.overdueList.length, 'overdue', tasks.overdueList.length ? 'bad' : ''),
    stat(dueToday.length, 'due today', dueToday.length ? 'warn' : ''),
    stat(tasks.active, 'in flight', tasks.active ? 'good' : ''),
    stat(dueWeek.length, 'due this week'),
    stat(compile.pending, 'pending compile', compile.pending ? 'warn' : ''),
    stat(knowledge.inboxItems, 'inbox items')
  ]);

  const goalCard = (icon: string, label: string, lines: string[]): string =>
    `<div class="goalcard"><h3 class="group"><span class="gicon">${icon}</span>${esc(label)}</h3>${
      lines.length
        ? `<ul class="plain">${lines.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>`
        : hint('not set yet')
    }</div>`;
  const goalsBody =
    goalCard('🗓', 'Weekly', goals.weekly) +
    goalCard('🎯', 'Monthly', goals.monthly) +
    goalCard('🧭', 'Yearly', goals.yearly);

  const focus =
    [
      taskGroup('⏰ Overdue', tasks.overdueList, snap, health.overdue > 0),
      taskGroup('📅 Due today', dueToday, snap),
      taskGroup('▶ In flight', active, snap)
    ].join('') || hint('Nothing due, nothing overdue, nothing in flight. Clear runway.');

  const waiting = blocked.length
    ? table(
        [],
        blocked
          .slice(0, 8)
          .map((ref) => [
            `<span class="nowrap">${mdLink(snap, ref.path, ref.id)}</span>`,
            `<span class="dim">${esc(truncate(ref.blockedBy, 110))}</span>`,
            projChip(ref.project)
          ])
      )
    : hint('Nothing explicitly waiting on anyone.');

  // The grounding feed: sessions worked, commands run, tasks touched, output
  // produced today. Group headers carry the icons; rows stay clean.
  const sessionsToday = snap.sessions.filter((sessionRef) => sessionRef.lastSeen === today && !sessionRef.isCommand);
  const commandsToday = snap.sessions.filter((sessionRef) => sessionRef.lastSeen === today && sessionRef.isCommand);
  const todaysReports = snap.reports.filter((report) => report.date === today);
  const touched = tasks.touchedToday;
  const sessionFeedRow = (sessionRef: (typeof snap.sessions)[number]): string =>
    `<div class="row"><span class="grow">${esc(
      truncate(sessionRef.briefing || '(local-command session)', 140)
    )}</span><span class="dim" style="flex:none">${sessionRef.turns} turns</span></div>`;
  const sessionRows = sessionsToday.map(sessionFeedRow);
  const commandRows = commandsToday.map(sessionFeedRow);
  const touchedRows = touched.map(
    (ref) =>
      `<div class="row"><span class="nowrap">${mdLink(
        snap,
        ref.path,
        ref.id
      )}</span><span class="grow">${esc(ref.title)}</span><span class="chip">${esc(ref.status)}</span>${projChip(ref.project)}</div>`
  );
  const outputRows = todaysReports.map((report) => reportRow(report, snap));
  const activity =
    sessionRows.length + commandRows.length + touchedRows.length + outputRows.length
      ? [
          sessionRows.length ? `<h3 class="group">💬 Sessions · ${sessionRows.length}</h3>${sessionRows.join('')}` : '',
          touchedRows.length
            ? `<h3 class="group">✏️ Tasks touched · ${touchedRows.length}</h3>${touchedRows.join('')}`
            : '',
          commandRows.length ? `<h3 class="group">⌘ Commands · ${commandRows.length}</h3>${commandRows.join('')}` : '',
          outputRows.length ? `<h3 class="group">📰 Output · ${outputRows.length}</h3>${outputRows.join('')}` : ''
        ].join('')
      : hint('Nothing yet today — it all lands here as you work.');

  const plan = [
    section('Focus', '', focus),
    section(
      'Next 7 days',
      `${dueWeek.length} due`,
      dueWeek.length ? dueWeek.map((ref) => taskRow(ref, snap)).join('') : hint('Nothing due this week.')
    ),
    section('Waiting on', `${tasks.blocked} blocked`, waiting)
  ].join('');

  // Headlines harvested from recent briefings, grouped by briefing day.
  const newsByDate = new Map<string, typeof snap.news>();
  for (const item of snap.news) {
    newsByDate.set(item.date, [...(newsByDate.get(item.date) ?? []), item]);
  }
  const news = snap.news.length
    ? [...newsByDate.entries()]
        .map(
          ([date, items]) =>
            `<h3 class="group">${esc(date || 'undated')}</h3>${items
              .map(
                (item) =>
                  `<div class="row" data-row><span class="grow">${extLink(item.url, item.title)}</span>${
                    item.source ? `<span class="chip">${esc(item.source)}</span>` : ''
                  }</div>`
              )
              .join('')}`
        )
        .join('')
    : hint('No headlines yet — briefings collect them as they run.');

  const activityCount = sessionsToday.length + commandsToday.length + touched.length + todaysReports.length;
  return page(
    'today',
    `Good ${part}${name} <span class="accent">✨</span>`,
    `${snap.runtime.date} · here's where everything stands.`,
    stats +
      subTabs([
        { id: 'plan', label: 'Plan', body: plan },
        { id: 'goals', label: 'Goals', body: section('Goals', 'from projects/TASKS.md', goalsBody) },
        { id: 'activity', label: `Today so far · ${activityCount}`, body: activity },
        {
          id: 'news',
          label: `News · ${snap.news.length}`,
          body: `<div data-filterbox>${filterInput('filter headlines…')}${news}</div>`
        }
      ])
  );
};

/** Hermes-style project card: header row + progress, expands to its tasks. */
const projectCard = (load: ProjectLoad, snap: StatusSnapshot): string => {
  const color = projectColor(load.project);
  const finished = load.done;
  const denominator = load.total + finished || 1;
  const pct = Math.round((finished / denominator) * 100);
  const ofStatus = (status: string) =>
    snap.tasks.queue.filter((ref) => ref.project === load.project && ref.status === status);
  // Project chips are redundant inside the project's own card.
  const noProject = { noProject: true };
  const taskRows =
    [
      taskGroup('▶ Active', ofStatus('active'), snap, false, noProject),
      taskGroup('○ Open', ofStatus('open'), snap, false, noProject),
      taskGroup('⛔ Blocked', ofStatus('blocked'), snap, false, noProject)
    ].join('') || hint('No live tasks — all done or archived.');
  const counts = [
    load.active && `<span class="good">${load.active} active</span>`,
    load.open && `<span style="color:var(--cyan)">${load.open} open</span>`,
    load.blocked && `<span class="bad">${load.blocked} blocked</span>`
  ]
    .filter(Boolean)
    .join('<span class="dim"> · </span>');
  return `<details class="projcard" data-row><summary>
<div class="proj-head"><span class="proj-dot" style="background:${color}"></span><span class="proj-name">${esc(load.project)}</span><span class="proj-counts">${counts || '<span class="dim">quiet</span>'}</span><span class="dim proj-meta">updated ${esc(relTime(load.updatedAt ? `${load.updatedAt}T00:00:00` : null))}</span></div>
${load.description ? `<div class="proj-desc">${esc(truncate(load.description, 160))}</div>` : ''}
<div class="proj-progress"><span class="dim nowrap">☑ ${finished} / ${denominator}</span><div class="track"><span style="width:${pct}%;background:${color}"></span></div><span class="dim nowrap">${pct}%</span></div>
</summary><div class="proj-tasks">${taskRows}</div></details>`;
};

const pageTasks = (snap: StatusSnapshot): string => {
  const { tasks } = snap;
  const today = snap.runtime.isoDate;

  const horizon = (ref: TaskRef): string => {
    if (!ref.due) return 'someday';
    const days = daysBetween(today, ref.due);
    if (days < 0) return 'overdue';
    if (days === 0) return 'today';
    if (days <= 7) return 'week';
    if (days <= 30) return 'month';
    return 'later';
  };
  const groups = new Map<string, TaskRef[]>();
  for (const ref of tasks.queue) {
    const key = horizon(ref);
    groups.set(key, [...(groups.get(key) ?? []), ref]);
  }
  const agenda = `<div data-filterbox>${filterInput('filter tasks…')}${[
    taskGroup('⏰ Overdue', groups.get('overdue') ?? [], snap),
    taskGroup('📅 Today', groups.get('today') ?? [], snap),
    taskGroup('🗓 This week', groups.get('week') ?? [], snap),
    taskGroup('📆 This month', groups.get('month') ?? [], snap),
    taskGroup('🔭 Later', groups.get('later') ?? [], snap),
    taskGroup('♾ No due date', groups.get('someday') ?? [], snap)
  ].join('')}</div>`;

  const blocked = tasks.queue.filter((ref) => ref.status === 'blocked');
  const attention = [
    section(
      'Blocked',
      String(blocked.length),
      blocked.length
        ? table(
            [],
            blocked.map((ref) => [
              `<span class="nowrap">${mdLink(snap, ref.path, ref.id)}</span>`,
              `<span class="dim">${esc(ref.blockedBy || `depends on ${ref.dependsOn.join(', ') || '?'}`)}</span>`,
              projChip(ref.project)
            ])
          )
        : hint('Nothing blocked.')
    ),
    section(
      'Going stale',
      String(tasks.stale),
      tasks.staleList.length
        ? tasks.staleList.map((ref) => taskRow(ref, snap)).join('')
        : hint('Nothing rotting. Nice.')
    )
  ].join('');

  return page(
    'tasks',
    'Tasks',
    `${tasks.queue.length} open tasks across ${tasks.projects} projects.`,
    subTabs([
      { id: 'agenda', label: 'Agenda', body: agenda },
      { id: 'attention', label: `Needs attention · ${blocked.length + tasks.stale}`, body: attention }
    ])
  );
};

const pageProjects = (snap: StatusSnapshot): string =>
  page(
    'projects',
    'Projects',
    `${snap.tasks.byProject.length} projects — click one to see its tasks.`,
    `<div data-filterbox>${filterInput('filter projects…')}${snap.tasks.byProject
      .map((load) => projectCard(load, snap))
      .join('')}</div>`
  );

const WEEK_COLORS = [
  'var(--cyan)',
  'var(--green)',
  'var(--accent)',
  'var(--magenta)',
  'var(--blue)',
  'var(--amber)',
  'var(--text)'
];

const pageSessions = (snap: StatusSnapshot): string => {
  const week = snap.knowledge.sessionsWeek;
  const volume =
    flexBar(week.map((day, index) => ({ value: day.bytes, color: WEEK_COLORS[index] }))) +
    legend(
      week.map((day, index) => ({
        label: `${day.label} ${day.bytes > 0 ? humanBytes(day.bytes) : '—'}`,
        color: WEEK_COLORS[index]
      }))
    );

  // Real working sessions only — command/skill invocations live on Today's
  // activity feed. Grouped by day; the home cwd is implied, others shown.
  const homeTilde = tildifyHome(snap.runtime.home);
  const conversations = snap.sessions.filter((sessionRef) => !sessionRef.isCommand);
  const sessionRow = (sessionRef: (typeof snap.sessions)[number]): string => {
    const cwd = tildifyHome(sessionRef.cwd.startsWith('~') ? sessionRef.cwd.replace('~', homedir()) : sessionRef.cwd);
    const where = cwd && cwd !== homeTilde ? `<div class="sess-cwd">${pathLink(sessionRef.cwd)}</div>` : '';
    return `<div class="row" data-row><span class="sess-turns nowrap" style="flex:none">${sessionRef.turns} turns</span><div class="grow"><div>${esc(
      truncate(sessionRef.briefing || '(no prompt captured)', 240)
    )}</div>${where}</div></div>`;
  };
  const byDay = new Map<string, typeof conversations>();
  for (const sessionRef of conversations) {
    byDay.set(sessionRef.lastSeen, [...(byDay.get(sessionRef.lastSeen) ?? []), sessionRef]);
  }
  const rows = conversations.length
    ? [...byDay.entries()]
        .map(([date, refs]) => `<h3 class="group">${esc(date || 'undated')}</h3>${refs.map(sessionRow).join('')}`)
        .join('')
    : hint('No sessions captured yet — they land here automatically as you work.');

  return page(
    'sessions',
    'Sessions',
    `What you and ${snap.persona.name} worked on, captured automatically.`,
    [
      section('Volume', 'last 7 days', volume),
      section(
        'Recent sessions',
        `last 30 days · ${conversations.length} shown`,
        `<div data-filterbox>${filterInput('filter sessions…')}${rows}</div>`
      )
    ].join('')
  );
};

const pageBrain = (snap: StatusSnapshot): string => {
  const { knowledge, compile, memoryThreads, memoryDecisions, memoryLearnings, memoryPending, memoryDailyFiles } = snap;

  const threads = [
    section('Active threads', `${knowledge.activeThreads} live`, plainRows(memoryThreads, 'Memory is quiet.')),
    section('Recent decisions', '', plainRows(memoryDecisions, 'No recent decisions recorded.'))
  ].join('');

  const concepts = knowledge.conceptDetails.length
    ? knowledge.conceptDetails
        .map(
          (concept) =>
            `<div class="row" data-row><span class="nowrap" style="flex:none">${mdLink(snap, concept.href, concept.name)}</span><span class="grow dim">${esc(concept.description)}</span></div>`
        )
        .join('')
    : hint('No concept articles compiled yet.');

  const memory = [
    section(
      'Daily memory',
      '14-day retention',
      memoryDailyFiles.length
        ? memoryDailyFiles
            .map(
              (file) =>
                `<div class="row" data-row><span class="nowrap" style="flex:none">${mdLink(snap, file.href, file.name)}</span><span class="grow dim">${esc(truncate(file.summary, 160))}</span></div>`
            )
            .join('')
        : hint('No daily memory files right now.')
    ),
    section(
      'Learnings',
      `how ${snap.persona.name} self-corrects`,
      plainRows(memoryLearnings, 'No learnings synthesized yet.')
    ),
    section('Pending', `open loops ${snap.persona.name} is tracking`, plainRows(memoryPending, 'No pending items.'))
  ].join('');

  const pipeline = [
    section(
      'Compile pipeline',
      `Σ $${compile.totalCostUsd.toFixed(2)}`,
      table(
        [],
        [
          ['sessions ingested', `<span class="grow">${compile.ingested}</span>`],
          [
            'pending',
            compile.pending > 0
              ? `<span class="warn" data-issue>${compile.pending} session(s) waiting for /${esc(snap.runtime.pluginName)}:sync</span>`
              : '<span class="dim">0 — fully absorbed</span>'
          ],
          ['last compiled', esc(relTime(compile.lastCompiled))],
          ['inbox to absorb', String(knowledge.inboxItems)]
        ]
      )
    ),
    section(
      'Memory footprint',
      '',
      table(
        [],
        [
          ['curated wiki', esc(humanBytes(knowledge.totalBytes))],
          ['memory index', esc(humanBytes(knowledge.memoryIndexBytes))],
          ['learnings', String(knowledge.learnings)],
          ['daily memory files', `${knowledge.memoryDaily} (14-day retention)`],
          ['feedback log', esc(humanBytes(knowledge.feedbackBytes))]
        ]
      )
    )
  ].join('');

  const { lint } = snap;
  const severityCls = (severity: string) => (severity === 'ERROR' ? 'bad' : severity === 'WARNING' ? 'warn' : 'dim');
  const lintBody = lint.present
    ? [
        section(
          'Last lint run',
          lint.date,
          table(
            [],
            [
              ['errors', `<span class="${lint.errors ? 'bad' : 'dim'}">${lint.errors}</span>`],
              ['warnings', `<span class="${lint.warnings ? 'warn' : 'dim'}">${lint.warnings}</span>`],
              ['suggestions', `<span class="dim">${lint.suggestions}</span>`],
              ['report', mdLink(snap, '.kevin/lint.md', 'open lint.md')]
            ]
          )
        ),
        section(
          'Issues',
          String(lint.issues.length),
          lint.issues.length
            ? lint.issues
                .map(
                  (issue) =>
                    `<div class="row" data-row><span class="${severityCls(issue.severity)} nowrap" style="flex:none">${esc(issue.severity)}</span><span class="grow">${esc(issue.text)}</span></div>`
                )
                .join('')
            : hint('Wiki is clean — nothing flagged.')
        )
      ].join('')
    : hint('No lint report yet — it lands here after the first sync.');

  return page(
    'brain',
    'Brain',
    `${snap.persona.name}'s living memory of your world — compiled from every session.`,
    subTabs([
      { id: 'threads', label: 'Threads', body: threads },
      { id: 'memory', label: 'Memory', body: memory },
      {
        id: 'concepts',
        label: `Concepts · ${knowledge.concepts}`,
        body: `<div data-filterbox>${filterInput('filter concepts…')}${concepts}</div>`
      },
      { id: 'pipeline', label: 'Pipeline', body: pipeline },
      { id: 'lint', label: `Lint · ${lint.errors + lint.warnings + lint.suggestions}`, body: lintBody }
    ])
  );
};

const pageReports = (snap: StatusSnapshot): string => {
  const byDate = new Map<string, ReportRef[]>();
  for (const report of snap.reports) {
    byDate.set(report.date, [...(byDate.get(report.date) ?? []), report]);
  }
  const groups = [...byDate.entries()]
    .map(
      ([date, reports]) =>
        `<h3 class="group">${esc(date || 'undated')}</h3>${reports.map((report) => reportRow(report, snap)).join('')}`
    )
    .join('');
  const note =
    snap.reportsTotal > snap.reports.length
      ? `<div class="dim" style="margin-top:10px">Showing latest ${snap.reports.length} of ${snap.reportsTotal} — full log in ${mdLink(snap, 'reports/index.md', 'reports/index.md')}</div>`
      : '';
  return page(
    'reports',
    'Reports',
    `Briefings, plans, and audits ${snap.persona.name} has produced. Click any title to open it.`,
    snap.reports.length
      ? `<div data-filterbox>${filterInput('filter reports…')}${groups}</div>${note}`
      : hint('No reports yet — briefings and plans will land here.')
  );
};

/** Curated starter recipes — product copy parameterized by plugin name. */
const cheatsheet = (plugin: string): Array<{ when: string; say: string; what: string }> => [
  {
    when: 'Morning and evening',
    say: `/${plugin}:sync`,
    what: 'Full refresh — compile, lint, flywheel, dashboard — then a briefing. Picks morning automatically before 3pm, evening from 3pm to 3am (or say `sync morning` / `sync evening`).'
  },
  {
    when: 'Between sessions',
    say: `/${plugin}:quick-pulse`,
    what: 'A fast status check without the heavy maintenance pass.'
  },
  {
    when: 'Feeling lost',
    say: `/${plugin}:where-am-i`,
    what: 'Radar of your recent sessions — what each was about, where it left off, how to resume it.'
  },
  {
    when: 'After a busy day',
    say: `/${plugin}:knowledge-compile`,
    what: 'Absorb captured sessions, feedback, and inbox drops into long-term memory.'
  },
  {
    when: '1st of the month',
    say: `/${plugin}:monthly-goals`,
    what: 'Set the month’s themes and big rocks (weekly-goals does the same per week).'
  },
  {
    when: 'Quarterly',
    say: `/${plugin}:yearly-goals`,
    what: 'Plan the year ahead quarter by quarter — run mid-year it shapes the remaining quarters; run in Q4 it drafts next year from Q1.'
  },
  {
    when: 'Once a month',
    say: `/${plugin}:self-review`,
    what: 'The agent reviews its own behavior against your feedback and proposes improvements.'
  },
  {
    when: 'Save anything',
    say: '“capture this: <url, text, or file>”',
    what: 'Drops it into the inbox; the next compile absorbs it into the wiki.'
  },
  {
    when: 'File work',
    say: '“create a task in <project>: …”',
    what: 'New task file with id, priority, and due date; shows up here and in TASKS.md.'
  },
  { when: 'Grab a page', say: '“screenshot https://…”', what: 'Headless-browser PNG into reports/captures/.' },
  {
    when: 'Make a PDF',
    say: '“turn <file or url> into a styled PDF”',
    what: 'Markdown/page rendered to PDF (mermaid included) in reports/captures/.'
  },
  {
    when: 'Research something',
    say: '“research <topic> and write it up”',
    what: 'Web research with sources, persisted as a report you can reread.'
  },
  {
    when: 'Refresh this page',
    say: `/${plugin}:status`,
    what: 'Regenerates this dashboard from current state.'
  }
];

const pageCapabilities = (snap: StatusSnapshot): string => {
  const { skills, mcp, hooks } = snap;

  const cheatRows = `<div data-filterbox>${filterInput('filter recipes…')}${table(
    ['when', 'say', 'what happens'],
    cheatsheet(snap.runtime.pluginName).map((recipe) => [
      `<span class="dim nowrap">${esc(recipe.when)}</span>`,
      `<span class="good">${esc(recipe.say)}</span>`,
      `<span class="dim">${esc(recipe.what)}</span>`
    ]),
    ' data-row'
  )}</div>`;

  const skillTiles = `<div data-filterbox>${filterInput('filter skills…')}<div class="tiles">${skills.details
    .map(
      (skill) =>
        `<div class="tile" data-row><div class="tname"><span class="good">/${esc(snap.runtime.pluginName)}:${esc(skill.name)}</span>${
          skill.custom ? ' <span class="chip">custom</span>' : ''
        }${skill.auto ? ' <span class="chip auto" title="the model may invoke this on its own">auto</span>' : ''}</div><div class="tdesc">${esc(skill.description || '—')}</div></div>`
    )
    .join('')}</div></div>`;

  const toolTiles = `<div data-filterbox>${filterInput('filter tools…')}<div class="tiles">${mcp.toolDetails
    .map(
      (tool) =>
        `<div class="tile" data-row><div class="tname">${esc(shortToolName(tool.name))}</div><div class="tdesc">${esc(
          tool.description || '—'
        )}</div></div>`
    )
    .join('')}</div></div>`;

  const hookRows = hooks.entries
    .map(
      (entry) =>
        `<div class="row"><span class="good nowrap" style="flex:none;min-width:120px">${esc(entry.event)}</span><span class="grow dim">${esc(entry.command)}</span></div>`
    )
    .join('');

  // The bin CLI's HELP text, section by section (entries already carry the
  // right shape per section — subcommands, env vars, example invocations).
  const cliBody = snap.cli.length
    ? `<div data-filterbox>${filterInput('filter commands…')}${snap.cli
        .map((cliSection) =>
          section(
            cliSection.section,
            '',
            cliSection.entries
              .map(
                (entry) =>
                  `<div class="row" data-row><span class="good" style="flex:none;max-width:46%">${esc(entry.cmd)}</span><span class="grow dim">${esc(entry.desc)}</span></div>`
              )
              .join('')
          )
        )
        .join('')}</div>`
    : hint('CLI help not found.');

  return page(
    'capabilities',
    'Capabilities',
    `Everything you can ask ${snap.persona.name} to do — skills by name, tools under the hood.`,
    subTabs([
      { id: 'cheatsheet', label: 'Cheatsheet', body: cheatRows },
      { id: 'skills', label: `Skills · ${skills.count}`, body: skillTiles },
      { id: 'tools', label: `Tools · ${mcp.toolCount}`, body: toolTiles },
      { id: 'commands', label: 'Commands', body: cliBody },
      { id: 'hooks', label: `Reflexes · ${hooks.count}`, body: hookRows }
    ])
  );
};

const pageProfile = (snap: StatusSnapshot): string => {
  const { operator } = snap;
  const avatar = operator.avatar ? `<img src="${esc(operator.avatar)}" alt="${esc(operator.name || 'avatar')}">` : '';
  const head = `<div class="persona-head">${avatar}<div><div class="p-name">${esc(operator.name || 'Operator')}</div><div class="p-kind">${esc(operator.timezone)}</div><div class="p-vibe">${esc(operator.headline || 'The operator profile grows as you work together.')}</div></div></div>`;

  // The compiled profile facet, section by section — the page Kevin would
  // write about you, not a list of file names.
  const profileSections = operator.profileSections
    .map((profileSection) =>
      section(
        profileSection.title,
        '',
        `<ul class="plain">${profileSection.lines.map((line) => `<li>${linkify(line)}</li>`).join('')}</ul>`
      )
    )
    .join('');

  const facetRows = operator.facets
    .map(
      (facet) =>
        `<div class="row"><span class="nowrap" style="flex:none;min-width:104px">${mdLink(snap, facet.href, facet.name)}</span><span class="grow dim">${esc(facet.description)}</span><span class="dim nowrap" style="flex:none">${esc(humanBytes(facet.bytes))}</span></div>`
    )
    .join('');

  return page(
    'profile',
    `${esc(operator.name || 'Profile')} <span class="accent">👤</span>`,
    `Who ${snap.persona.name} is working for — compiled from every session.`,
    [
      head,
      profileSections || hint('No profile compiled yet — it grows as you work together.'),
      section(
        'Go deeper',
        `${operator.facets.length} facets`,
        facetRows || hint('No facets yet — they grow as you work together.')
      )
    ].join('')
  );
};

const pagePersona = (snap: StatusSnapshot): string => {
  const { persona, runtime, settings } = snap;
  const avatar = persona.avatar ? `<img src="${esc(persona.avatar)}" alt="${esc(persona.name)}">` : '';
  const head = `<div class="persona-head">${avatar}<div><div class="p-name">${esc(persona.name)} ${esc(persona.emoji)}</div><div class="p-kind">${esc(persona.kind)}</div><div class="p-vibe">${esc(persona.vibe)}</div></div></div>`;
  const bio = persona.bio ? `<p class="bio">${esc(persona.bio)}</p>` : '';
  const bullets = (items: string[]): string =>
    items.length
      ? `<ul class="plain">${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`
      : hint('(not written yet)');
  const runtimeRows = table(
    [],
    [
      ['version', `v${esc(runtime.version)}`],
      ['plugin', esc(settings.plugin?.ref ?? runtime.pluginName)],
      ['marketplace', esc(settings.plugin ? `${settings.plugin.marketplace} (${settings.plugin.sourceType})` : '—')],
      ['plugin path', pathLink(runtime.pluginRoot)],
      ['home', pathLink(runtime.home)],
      ['timezone', esc(runtime.timezone)]
    ]
  );
  return page(
    'persona',
    `${esc(persona.name)} <span class="accent">${esc(persona.emoji)}</span>`,
    'Your life co-pilot — who he is and how he runs.',
    [
      head,
      bio,
      section('Core role', '', bullets(persona.roles)),
      section('Soul', 'from SOUL.md', bullets(persona.soulTraits)),
      section(
        'Identity files',
        '',
        `<div class="row"><span class="grow dim">${esc(persona.name)}'s character and role — edit these to evolve them.</span><span class="nowrap">${mdLink(snap, 'SOUL.md', 'SOUL.md')} · ${mdLink(snap, 'IDENTITY.md', 'IDENTITY.md')}</span></div>`
      ),
      section('Runtime', '', runtimeRows)
    ].join('')
  );
};

const GROUP_COLORS: Record<ContextGroup, string> = {
  instructions: 'var(--cyan)',
  identity: 'var(--accent)',
  facets: 'var(--magenta)',
  knowledge: 'var(--green)',
  tasks: 'var(--blue)',
  other: 'var(--dim)'
};

const MANIFEST_ICON: Record<ManifestEntry['status'], { icon: string; cls: string }> = {
  loaded: { icon: '✓', cls: 'good' },
  missing: { icon: '✗', cls: 'bad' },
  unavailable: { icon: '⚠', cls: 'warn' }
};

const pageSystem = (snap: StatusSnapshot): string => {
  const { context, settings, logs, health } = snap;

  const sums = (Object.keys(GROUP_COLORS) as ContextGroup[])
    .map((key) => ({
      key,
      bytes: context.staticImports.filter((item) => item.group === key).reduce((sum, item) => sum + item.bytes, 0)
    }))
    .filter((group) => group.bytes > 0);
  const composition =
    flexBar(sums.map((group) => ({ value: group.bytes, color: GROUP_COLORS[group.key] }))) +
    legend(sums.map((group) => ({ label: `${group.key} ${humanBytes(group.bytes)}`, color: GROUP_COLORS[group.key] })));

  let facetsEmitted = false;
  const staticRows = context.staticImports.flatMap((item) => {
    if (item.group === 'facets') {
      if (facetsEmitted) return [];
      facetsEmitted = true;
      const facets = context.staticImports.filter((entry) => entry.group === 'facets');
      const bytes = facets.reduce((sum, entry) => sum + entry.bytes, 0);
      return [
        [
          '<span class="good">✓</span>',
          esc(`knowledge/user/* (${facets.length})`),
          `<span class="dim">${esc(humanBytes(bytes))}</span>`
        ]
      ];
    }
    return [
      [
        item.present ? '<span class="good">✓</span>' : '<span class="bad" data-issue>✗</span>',
        item.present ? mdLink(snap, item.label, item.label, 'plink') : esc(item.label),
        `<span class="dim">${esc(humanBytes(item.bytes))}</span>`
      ]
    ];
  });

  const manifestRows = context.dynamic.entries.map((entry) => {
    const { icon, cls } = MANIFEST_ICON[entry.status];
    return [
      `<span class="${cls}">${icon}</span>`,
      esc(entry.label),
      `<span class="dim">${esc(humanBytes(entry.bytes))}</span>`
    ];
  });

  const contextBody = [
    section(
      'Context loaded every session',
      `${context.staticImports.length} sources · ${humanBytes(context.staticBytes)}`,
      composition + table(['', 'source', 'size'], staticRows)
    ),
    section('Injected at SessionStart', humanBytes(context.dynamic.bytes), table(['', 'entry', 'size'], manifestRows))
  ].join('');

  // Path-valued env vars (KEVIN_HOME etc.) become Finder links; masked
  // secrets and plain values render as text.
  const envRows = settings.env.map((entry) => [
    `<span class="nowrap">${esc(entry.key)}</span>`,
    /^~?\//.test(entry.value) ? pathLink(entry.value) : esc(tildifyHome(entry.value)),
    `<span class="dim">${esc(entry.scope)}</span>`
  ]);
  // One row per settings layer, so the user/project/local scopes and what
  // each contributes are visible at a glance.
  const layerRows = settings.layers.map((layer) => [
    `<span class="nowrap">${esc(layer.label)}</span>`,
    layer.present ? pathLink(layer.path) : `<span class="dim">${esc(tildifyHome(layer.path))} (absent)</span>`,
    layer.present
      ? `<span class="${layer.allow ? 'good' : 'dim'}">${layer.allow}</span>`
      : '<span class="dim">—</span>',
    layer.present ? `<span class="${layer.deny ? 'warn' : 'dim'}">${layer.deny}</span>` : '<span class="dim">—</span>',
    layer.present ? `<span class="dim">${layer.envCount}</span>` : '<span class="dim">—</span>'
  ]);
  const pluginRows = settings.plugin
    ? [
        ['plugin', esc(settings.plugin.ref)],
        ['marketplace', esc(`${settings.plugin.marketplace} (${settings.plugin.sourceType})`)],
        ...(settings.plugin.sourcePath ? [['source path', pathLink(settings.plugin.sourcePath)]] : [])
      ]
    : [['plugin', '<span class="dim">not detected</span>']];
  const settingsBody = [
    section(
      'Settings layers',
      `${settings.allow} allow · ${settings.deny} deny total`,
      table(['scope', 'file', 'allow', 'deny', 'env'], layerRows)
    ),
    section(
      'Plugin',
      '',
      table(
        [],
        [
          ...pluginRows,
          ['plugins enabled', esc(settings.enabledPlugins.map((name) => name.split('@')[0]).join(' · ') || '—')]
        ]
      )
    ),
    section('Environment', `${settings.env.length} vars · secrets redacted`, table(['key', 'value', 'scope'], envRows))
  ].join('');

  const logsBody = [
    section(
      'Health',
      '',
      table(
        [],
        [
          ['file', `${pathLink(logs.path)} <span class="dim">(${esc(humanBytes(logs.bytes))})</span>`],
          [
            'today',
            `<span class="${logs.warnings > 0 ? 'warn' : 'dim'}">${logs.warnings} warn</span> · <span class="${logs.errors > 0 ? 'bad' : 'dim'}"${health.logErrors > 0 ? ' data-issue' : ''}>${logs.errors} err</span>`
          ],
          ...(logs.lastError ? [['last err', `<span class="dim">${esc(logs.lastError)}</span>`]] : []),
          ['all-time', `<span class="dim">${logs.totalWarnings} warn · ${logs.totalErrors} err</span>`]
        ]
      )
    ),
    section(
      'Tail',
      humanBytes(Buffer.byteLength(logs.tail)),
      logs.tail ? `<pre class="logtail">${esc(logs.tail)}</pre>` : hint('No log output yet.')
    )
  ].join('');

  return page(
    'system',
    'System',
    'The machinery — context assembly, settings, logs.',
    subTabs([
      { id: 'context', label: 'Context', body: contextBody },
      { id: 'settings', label: 'Settings', body: settingsBody },
      { id: 'logs', label: 'Logs', body: logsBody }
    ])
  );
};

// ── shell assembly ────────────────────────────────────────────────────

// The generated timestamp lives in the footer, and the operator card carries
// the timezone — the banner only needs identity plus a Finder-able home path.
const sidebarBanner = (snap: StatusSnapshot): string =>
  [
    `<pre class="wordmark">${esc(BANNER_LINES.join('\n'))}</pre>`,
    `<div class="tagline">${esc(BANNER_TAG)} <span class="ver">v${esc(snap.runtime.version)}</span></div>`,
    `<div class="dateline">${pathLink(snap.runtime.home)}</div>`
  ].join('\n');

const sidebarNav = (snap: StatusSnapshot): string =>
  PAGES.filter((item) => !('hidden' in item && item.hidden))
    .map((item) => {
      const icon = item.id === 'persona' && snap.persona.emoji ? snap.persona.emoji : item.icon;
      return `<a class="nav-item" data-nav="${item.id}" href="#${item.id}"><span class="ico">${esc(icon)}</span>${esc(item.label)}</a>`;
    })
    .join('\n');

const healthBadge = (snap: StatusSnapshot): string => {
  const { health } = snap;
  if (health.ok) return '<span class="badge ok"><span class="pulse"></span>ALL SYSTEMS NOMINAL</span>';
  const issues = [
    health.overdue && `${health.overdue} overdue`,
    health.pendingCompiles && `${health.pendingCompiles} pending`,
    health.logErrors && `${health.logErrors} errors`,
    health.missingImports && `${health.missingImports} missing`,
    health.stale && `${health.stale} stale`
  ].filter(Boolean);
  return `<span class="badge warn" title="jump to first issue"><span class="pulse"></span>${esc(issues.join(' · '))}</span>`;
};

const sidebarFoot = (snap: StatusSnapshot): string => {
  const { operator } = snap;
  const avatar = operator.avatar
    ? `<img src="${esc(operator.avatar)}" alt="${esc(operator.name || 'avatar')}">`
    : `<span class="op-fallback">👤</span>`;
  const card = `<a class="op-card" href="#profile">${avatar}<span><span class="op-name">${esc(operator.name || 'Operator')}</span><br><span class="op-tz">${esc(operator.timezone || '')}</span></span></a>`;
  return card + healthBadge(snap);
};

const fill = (template: string, slots: Record<string, string>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => slots[token] ?? '');

const PAGE_BUILDERS: Record<(typeof PAGES)[number]['id'], (snap: StatusSnapshot) => string> = {
  today: pageToday,
  tasks: pageTasks,
  projects: pageProjects,
  sessions: pageSessions,
  brain: pageBrain,
  reports: pageReports,
  capabilities: pageCapabilities,
  profile: pageProfile,
  persona: pagePersona,
  system: pageSystem
};

export const renderDashboardHtml = (snap: StatusSnapshot): string => {
  const generated = `${snap.runtime.date} ${snap.runtime.time} ${snap.runtime.timezone}`;
  return fill(TEMPLATE, {
    TITLE: esc(`${snap.persona.name} · Agent OS`),
    EMOJI: esc(snap.persona.emoji || '🤖'),
    BANNER: sidebarBanner(snap),
    NAV: sidebarNav(snap),
    SIDEFOOT: sidebarFoot(snap),
    PAGES: PAGES.map((item) => PAGE_BUILDERS[item.id](snap)).join('\n'),
    FOOTER: `generated ${esc(generated)}<span class="sep">·</span>snapshot, not live<span class="sep">·</span>regenerate with /${esc(snap.runtime.pluginName)}:sync`
  });
};
