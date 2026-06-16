/**
 * Fills dashboard.html with a StatusSnapshot — the Agent OS dashboard at
 * `<HOME>/dashboard.html`.
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
import type {
  ContextGroup,
  ProfileSection,
  ProjectLoad,
  RadarLatest,
  RadarSession,
  ReportRef,
  StatusSnapshot,
  TaskRef
} from './collect';
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
  { id: 'scheduler', icon: '⏰', label: 'Scheduler' },
  { id: 'capabilities', icon: '🧩', label: 'Capabilities' },
  { id: 'profile', icon: '👤', label: 'Profile', hidden: true },
  { id: 'persona', icon: '🍌', label: 'Persona' },
  { id: 'system', icon: '⚙️', label: 'System' },
  { id: 'status', icon: '🩺', label: 'Status', hidden: true }
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

/** Stable hue per name (djb2 hash, full-width before the mod, so similar
 *  names land far apart) — used for project and skill badges. */
const nameHue = (name: string): number => {
  let hash = 5381;
  for (const ch of name) hash = ((hash * 33) ^ (ch.codePointAt(0) ?? 0)) >>> 0;
  return hash % 360;
};

const projectColor = (name: string): string => `hsl(${nameHue(name)}, 55%, 62%)`;

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
  )}">${esc(ref.priority)}</span><span class="caret" aria-hidden="true">▸</span></summary><div class="taskbody">${esc(details.join(' · '))}${open}</div></details>`;
};

const taskGroup = (title: string, refs: TaskRef[], snap: StatusSnapshot, options: TaskRowOptions = {}): string =>
  refs.length
    ? `<h3 class="group">${esc(title)} · ${refs.length}</h3>${refs.map((ref) => taskRow(ref, snap, options)).join('')}`
    : '';

/** Radar-derived session row for the Today › Ongoing feed: time-ago in the
 *  first column, title second, expanding (like a task row) to the full summary
 *  and the `claude --resume` command. */
const radarSessionRow = (session: RadarSession): string => {
  const resume = session.resume ? `<div class="resume">↳ <code>${esc(session.resume)}</code></div>` : '';
  return `<details class="task radarrow" data-row><summary><span class="tid nowrap dim">${esc(
    session.timeAgo
  )}</span><span class="ttl">${esc(session.title)}</span><span class="caret" aria-hidden="true">▸</span></summary><div class="taskbody">${
    session.summary ? `<div class="radarsum">${esc(session.summary)}</div>` : ''
  }${resume}</div></details>`;
};

// ── pages ─────────────────────────────────────────────────────────────

const reportRow = (report: ReportRef, snap: StatusSnapshot): string => {
  const title = report.href ? mdLink(snap, report.href, report.title) : esc(report.title);
  // Skill chip when there is one (briefings, radar); fall back to the category
  // so chip-less rows (plan-mode exports have no skill) still carry a tag.
  const chip = report.skill ? projChip(report.skill) : report.category ? projChip(report.category) : '';
  return `<div class="row" data-row data-cat="${esc(report.category)}"><span class="dim" style="flex:none">${esc(report.time)}</span><span style="flex:none">${esc(
    report.status
  )}</span><span class="grow">${title}</span>${chip}</div>`;
};

/** Category filter chips for the Reports page — All + one per category that
 *  actually has reports. Each carries the same colored dot the matching row
 *  chips use (briefings borrows the morning-briefing hue), so the filter reads
 *  as the same vocabulary as the list. `data-catchips` wires the client filter. */
const reportChips = (reports: ReportRef[]): string => {
  const counts = reports.reduce<Record<string, number>>((acc, report) => {
    if (report.category) acc[report.category] = (acc[report.category] ?? 0) + 1;
    return acc;
  }, {});
  const present = REPORT_CATEGORY_ORDER.filter((category) => counts[category]);
  if (present.length < 2) return ''; // nothing to filter between
  const chip = (filter: string, label: string, count: number, dotKey: string, active: boolean): string => {
    const dot = dotKey ? `<i style="background:${projectColor(dotKey)}"></i>` : '';
    return `<button class="chip proj catchip${active ? ' active' : ''}" data-catfilter="${esc(filter)}">${dot}${esc(label)} <span class="dim">${count}</span></button>`;
  };
  return `<div class="chips" data-catchips>${chip('all', 'All', reports.length, '', true)}${present
    .map((category) => chip(category, `${category[0].toUpperCase()}${category.slice(1)}`, counts[category], CATEGORY_DOT[category], false))
    .join('')}</div>`;
};

const REPORT_CATEGORY_ORDER = ['briefings', 'plans', 'radar'] as const;

/** Dot hue per category — keyed to a representative row chip so the filter and
 *  the list share colors. Briefings uses the morning-briefing skill's hue. */
const CATEGORY_DOT: Record<string, string> = {
  briefings: 'morning-briefing',
  plans: 'plans',
  radar: 'where-am-i'
};

const pageToday = (snap: StatusSnapshot): string => {
  const { tasks, runtime, compile, knowledge, goals } = snap;
  const today = runtime.isoDate;
  const hour = parseInt(runtime.time.slice(0, 2), 10) || 0;
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const name = snap.operator.name ? `, ${esc(snap.operator.name)}` : '';

  const dueToday = tasks.queue.filter((ref) => ref.due === today && ref.status !== 'blocked');
  // Blocked tasks live in "Waiting on" — keep them out of the due lists.
  const dueWeek = tasks.queue.filter((ref) => {
    if (!ref.due || ref.status === 'blocked') return false;
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
        : hint(`No ${label.toLowerCase()} goals set yet, run the ${label.toLowerCase()}-goals skill.`)
    }</div>`;
  const goalsBody =
    goalCard('🗓', 'Weekly', goals.weekly) +
    goalCard('🎯', 'Monthly', goals.monthly) +
    goalCard('🧭', 'Yearly', goals.yearly);

  const focus =
    [
      taskGroup('⏰ Overdue', tasks.overdueList, snap),
      taskGroup('📅 Due today', dueToday, snap),
      taskGroup('🚀 In flight', active, snap)
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

  // The grounding feed covers the last ~24h so it survives midnight: sessions
  // and tasks carry date-only stamps (today + yesterday); reports have times
  // and filter precisely. Sessions with nothing captured are noise — dropped.
  // `today` is already timezone-anchored, so do the day arithmetic in UTC —
  // a local parse + toISOString round-trip lands on the wrong day in UTC+ zones.
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const inWindow = (sessionRef: (typeof snap.sessions)[number]) =>
    (sessionRef.lastSeen === today || sessionRef.lastSeen === yesterday) && Boolean(sessionRef.briefing);
  const commandsToday = snap.sessions.filter((sessionRef) => inWindow(sessionRef) && sessionRef.isCommand);
  // The Sessions group is sourced from the latest radar digest (time-ago +
  // title, expandable to summary + resume), not the raw session index.
  const radarSessions = snap.radarLatest?.sessions ?? [];
  const todaysReports = snap.reports.filter(
    (report) => report.date === today || (report.date === yesterday && report.time > runtime.time)
  );
  const touched = tasks.touchedToday;
  const sessionFeedRow = (sessionRef: (typeof snap.sessions)[number]): string => {
    const dayNote =
      sessionRef.lastSeen === yesterday ? '<span style="display:block;font-size:10px">yesterday</span>' : '';
    return `<div class="row"><span class="dim nowrap" style="flex:none;min-width:48px">${esc(sessionRef.time || '—')}${dayNote}</span><span class="grow">${esc(
      truncate(sessionRef.briefing || '(local-command session)', 300)
    )}</span><div class="nowrap" style="flex:none;text-align:right"><div class="dim">${sessionRef.turns} turns</div>${resumedChip(sessionRef)}</div></div>`;
  };
  const radarRows = radarSessions.map(radarSessionRow);
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
    radarRows.length + commandRows.length + touchedRows.length + outputRows.length
      ? [
          radarRows.length ? `<h3 class="group">💬 Sessions · ${radarRows.length}</h3>${radarRows.join('')}` : '',
          touchedRows.length
            ? `<h3 class="group">✏️ Tasks touched · ${touchedRows.length}</h3>${touchedRows.join('')}`
            : '',
          commandRows.length ? `<h3 class="group">⚡ Commands · ${commandRows.length}</h3>${commandRows.join('')}` : '',
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
            `<h3 class="group date">${esc(date || 'undated')}</h3>${items
              .map(
                (item) =>
                  `<div class="row" data-row><span class="grow">${item.url ? extLink(item.url, item.title) : esc(item.title)}</span>${
                    item.source ? `<span class="chip">${esc(item.source)}</span>` : ''
                  }</div>`
              )
              .join('')}`
        )
        .join('')
    : hint('No headlines yet — briefings collect them as they run.');

  const activityCount = radarSessions.length + commandsToday.length + touched.length + todaysReports.length;
  return page(
    'today',
    `Good ${part}${name} <span class="accent">✨</span>`,
    `${snap.runtime.date} · here's where everything stands.`,
    stats +
      subTabs([
        { id: 'plan', label: 'Plan', body: plan },
        { id: 'activity', label: `Ongoing · ${activityCount}`, body: activity },
        { id: 'goals', label: 'Goals', body: section('Goals', 'from projects/TASKS.md', goalsBody) },
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
      taskGroup('▶ Active', ofStatus('active'), snap, noProject),
      taskGroup('○ Open', ofStatus('open'), snap, noProject),
      taskGroup('⛔ Blocked', ofStatus('blocked'), snap, noProject)
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

/** Sessions started on an earlier day wear that day's briefing — mark them
 *  so an old-sounding entry under today's date reads as a resume, not noise. */
const resumedChip = (sessionRef: StatusSnapshot['sessions'][number]): string =>
  sessionRef.firstSeen && sessionRef.firstSeen !== sessionRef.lastSeen
    ? `<span class="chip" title="resumed session — started ${esc(sessionRef.firstSeen)}">↩ since ${esc(sessionRef.firstSeen)}</span>`
    : '';

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
  const conversations = snap.sessions.filter((sessionRef) => !sessionRef.isCommand && sessionRef.briefing);
  const sessionRow = (sessionRef: (typeof snap.sessions)[number]): string => {
    const cwd = tildifyHome(sessionRef.cwd.startsWith('~') ? sessionRef.cwd.replace('~', homedir()) : sessionRef.cwd);
    const where = cwd && cwd !== homeTilde ? `<div class="sess-cwd">${pathLink(sessionRef.cwd)}</div>` : '';
    return `<div class="row" data-row><span class="sess-turns nowrap" style="flex:none">${sessionRef.turns} turns</span><div class="grow"><div>${esc(
      truncate(sessionRef.briefing, 240)
    )}</div>${where}</div>${resumedChip(sessionRef)}</div>`;
  };
  const byDay = new Map<string, typeof conversations>();
  for (const sessionRef of conversations) {
    byDay.set(sessionRef.lastSeen, [...(byDay.get(sessionRef.lastSeen) ?? []), sessionRef]);
  }
  const rows = conversations.length
    ? [...byDay.entries()]
        .map(([date, refs]) => `<h3 class="group date">${esc(date || 'undated')}</h3>${refs.map(sessionRow).join('')}`)
        .join('')
    : hint('No sessions captured yet — they land here automatically as you work.');

  // No section header — the History sub-tab already names it; the count rides
  // along the bottom of the list (mirrors the Recent tab's footer note).
  const recentFooter = conversations.length
    ? `<div class="list-footer">${conversations.length} sessions · last 30 days</div>`
    : '';
  const recent = `<div data-filterbox>${filterInput('filter sessions…')}${rows}</div>${recentFooter}`;

  // Volume lives above the tabs so the 7-day bar stays visible on both tabs.
  return page(
    'sessions',
    'Sessions',
    `What you and ${snap.persona.name} worked on, captured automatically.`,
    section('Volume', 'last 7 days', volume) +
      subTabs([
        { id: 'radar', label: '🛰️ Recent', body: radarTab(snap) },
        { id: 'history', label: '🕘 History', body: recent },
        { id: 'locations', label: '📍 Locations', body: locationsTab(snap) }
      ])
  );
};

/** Locations tab — every distinct working directory the sessions ran in, with
 *  its most recent date and session count. An at-a-glance map of where on the
 *  machine you've been working. */
const locationsTab = (snap: StatusSnapshot): string => {
  const byLoc = new Map<string, { lastSeen: string; count: number }>();
  for (const sessionRef of snap.sessions) {
    if (!sessionRef.cwd) continue;
    const prev = byLoc.get(sessionRef.cwd);
    byLoc.set(sessionRef.cwd, {
      lastSeen: prev && prev.lastSeen > sessionRef.lastSeen ? prev.lastSeen : sessionRef.lastSeen,
      count: (prev?.count ?? 0) + 1
    });
  }
  const rows = [...byLoc.entries()]
    .sort((a, b) => b[1].lastSeen.localeCompare(a[1].lastSeen))
    .map(
      ([cwd, info]) =>
        `<div class="row" data-row><span class="grow">${pathLink(cwd)}</span><span class="dim nowrap">${
          info.count
        } session${info.count > 1 ? 's' : ''}</span><span class="dim nowrap">${esc(info.lastSeen)}</span></div>`
    )
    .join('');
  return byLoc.size
    ? `<div data-filterbox>${filterInput('filter locations…')}${rows}</div>`
    : hint('No working directories captured yet.');
};

/** Recent (radar) tab — the latest where-am-i digest rendered inline, plus a
 *  pointer to earlier radars in the Reports log. The digest groups sessions
 *  into cards (title + time-ago, summary, resume badge); `.radar-md` styles the
 *  rendered markdown to match. */
const radarTab = (snap: StatusSnapshot): string => {
  const latest: RadarLatest | null = snap.radarLatest;
  const plugin = snap.runtime.pluginName;
  if (!latest) {
    return hint(`No radar captured yet — run /${plugin}:where-am-i (or a sync) to snapshot your sessions.`);
  }
  const radarCount = snap.reports.filter((report) => report.category === 'radar').length;
  // Footer below the divider: the digest's stats line, then the radar-count note.
  const footerLines = [
    latest.footer ? esc(latest.footer) : '',
    radarCount > 1
      ? `${radarCount} radars on record — earlier ones live in the <span class="navlink" data-nav="reports">Reports</span> page under the Radar filter.`
      : ''
  ].filter(Boolean);
  const more = footerLines.length ? `<div class="radar-more">${footerLines.join('<br>')}</div>` : '';
  // Build the header by hand: section()'s `right` is esc()'d, which would print
  // the open-link's raw HTML, so the link can't go through it.
  const meta = `<span class="right">${esc(`${latest.date} ${latest.time}`)} · ${mdLink(snap, latest.href, 'open')}</span>`;
  return `<div class="section"><h2>Latest radar<i></i>${meta}</h2><div class="radar-md">${latest.html}</div></div>${more}`;
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
            `<div class="row" data-row><span class="grow">${mdLink(snap, concept.href, concept.name)} <span class="dim">— ${esc(concept.description)}</span></span></div>`
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
              ? `<span class="warn">${compile.pending} session(s) waiting for /${esc(snap.runtime.pluginName)}:sync</span>`
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
      { id: 'context', label: 'Context', body: buildContextBody(snap) },
      { id: 'memory', label: 'Memory', body: memory },
      { id: 'threads', label: 'Threads', body: threads },
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
        `<h3 class="group date">${esc(date || 'undated')}</h3>${reports.map((report) => reportRow(report, snap)).join('')}`
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
      ? `<div data-filterbox>${filterInput('filter reports…')}${reportChips(snap.reports)}${groups}</div>${note}`
      : hint('No reports yet — briefings, plans, and radars will land here.')
  );
};

// ── scheduler ─────────────────────────────────────────────────────────
// Placeholder reminder of the recurring routines and when to run them. Every
// job is manual today — lo-046 will fire them in-session against the
// subscription bucket. `nextDate` returns the next calendar date the cadence
// lands on; `resolveNextRun` rolls it forward when today's slot has passed.

interface ScheduledJob {
  label: string;
  /** Plugin skill invoked, e.g. `sync` → `/<plugin>:sync`. */
  skill: string;
  /** Human cadence shown in the When column. */
  when: string;
  /** Target time of day (HH:MM), used both for display and slot-passed checks. */
  anchor: string;
  /** Next calendar date (YYYY-MM-DD) the cadence falls on, today inclusive. */
  nextDate: (todayIso: string) => string;
}

const addDays = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const ymd = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** Next occurrence of weekday `target` (0=Sun..6=Sat), today inclusive. */
const nextWeekday = (iso: string, target: number): string =>
  addDays(iso, (target - new Date(`${iso}T00:00:00Z`).getUTCDay() + 7) % 7);

/** Next month-day `target` (e.g. 1 or 15), today inclusive. */
const nextMonthlyDay = (iso: string, target: number): string => {
  const [year, month] = iso.split('-').map(Number);
  if (Number(iso.slice(8, 10)) <= target) return ymd(year, month, target);
  return month === 12 ? ymd(year + 1, 1, target) : ymd(year, month + 1, target);
};

/** Next quarter start (Jan/Apr/Jul/Oct 1), today inclusive. */
const nextQuarterStart = (iso: string): string => {
  const [year, month] = iso.split('-').map(Number);
  const onFirst = Number(iso.slice(8, 10)) === 1;
  const start = [1, 4, 7, 10].find((qm) => qm > month || (qm === month && onFirst));
  return start ? ymd(year, start, 1) : ymd(year + 1, 1, 1);
};

const SCHEDULE: ScheduledJob[] = [
  { label: 'Sync (morning)', skill: 'sync', when: 'Daily', anchor: '07:00', nextDate: (iso) => iso },
  { label: 'Sync (evening)', skill: 'sync', when: 'Daily', anchor: '19:00', nextDate: (iso) => iso },
  { label: 'Weekly goals', skill: 'weekly-goals', when: 'Mondays', anchor: '08:00', nextDate: (iso) => nextWeekday(iso, 1) },
  { label: 'Monthly goals', skill: 'monthly-goals', when: '1st of month', anchor: '08:00', nextDate: (iso) => nextMonthlyDay(iso, 1) },
  { label: 'Yearly goals', skill: 'yearly-goals', when: 'Quarterly · Jan/Apr/Jul/Oct 1', anchor: '08:00', nextDate: nextQuarterStart },
  { label: 'Self-review', skill: 'self-review', when: '15th of month', anchor: '08:00', nextDate: (iso) => nextMonthlyDay(iso, 15) }
];

/** Roll the next date forward a period when today is the target but its time slot already passed. */
const resolveNextRun = (job: ScheduledJob, todayIso: string, nowHHMM: string): string => {
  const candidate = job.nextDate(todayIso);
  return candidate === todayIso && nowHHMM >= job.anchor ? job.nextDate(addDays(todayIso, 1)) : candidate;
};

const prettyDate = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });

const pageScheduler = (snap: StatusSnapshot): string => {
  const today = snap.runtime.isoDate;
  const now = snap.runtime.time;
  const plugin = snap.runtime.pluginName;

  const cards = SCHEDULE.map((job) => {
    const next = resolveNextRun(job, today, now);
    const days = daysBetween(today, next);
    const rel = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days}d`;
    return `<div class="schedcard">
<div class="sched-head"><span class="sched-name">${esc(job.label)}</span><span class="chip manual">manual</span></div>
<div class="sched-when dim">${esc(job.when)} · ${esc(job.anchor)}</div>
<div class="sched-next"><span class="dim">next</span> ${esc(prettyDate(next))} <span class="dim">${esc(rel)}</span></div>
<div class="sched-invoke good">/${esc(plugin)}:${esc(job.skill)}</div>
</div>`;
  }).join('');

  return page(
    'scheduler',
    `Scheduler <span class="accent">⏰</span>`,
    'Recurring routines and when to run them — manual for now.',
    `<div class="cardgrid">${cards}</div>`
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
    say: `/${plugin}:dashboard`,
    what: 'Regenerates this dashboard (and TASKS.md) from current state.'
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
        `<div class="tile" data-row><div class="tname"><span class="good">${esc(shortToolName(tool.name))}</span></div><div class="tdesc">${esc(
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
                  `<div class="row" data-row><div class="grow"><div class="good">${esc(entry.cmd)}</div>${
                    entry.desc ? `<div class="dim" style="font-size:12px;margin-top:2px">${esc(entry.desc)}</div>` : ''
                  }</div></div>`
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
  // Interleave the two files in source order (identity first, then soul) so
  // the page alternates what-he-does with who-he-is instead of dumping one
  // file after the other.
  const labelled = (sections: ProfileSection[], source: string) => sections.map((item) => ({ ...item, source }));
  const identity = labelled(persona.identitySections, 'IDENTITY.md');
  const soul = labelled(persona.soulSections, 'SOUL.md');
  const interleaved = Array.from({ length: Math.max(identity.length, soul.length) }, (_, i) => i).flatMap((i) =>
    [identity[i], soul[i]].filter((item): item is (typeof identity)[number] => Boolean(item))
  );
  const personaSections = interleaved
    .map((item) =>
      section(
        item.title,
        `from ${item.source}`,
        `<ul class="plain">${item.lines.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>`
      )
    )
    .join('');
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
      personaSections || section('Identity', 'from IDENTITY.md + SOUL.md', hint('(not written yet)')),
      section(
        'Files',
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

/** The "what loads into every session" view — static @-imports plus the
 *  SessionStart injection. Lives on the Brain page (it's Kevin's context),
 *  surfaced here as a standalone builder so pageBrain can mount it. */
const buildContextBody = (snap: StatusSnapshot): string => {
  const { context } = snap;

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

  return [
    section(
      'Context loaded every session',
      `${context.staticImports.length} sources · ${humanBytes(context.staticBytes)}`,
      composition + table(['', 'source', 'size'], staticRows)
    ),
    section('Injected at SessionStart', humanBytes(context.dynamic.bytes), table(['', 'entry', 'size'], manifestRows))
  ].join('');
};

const pageSystem = (snap: StatusSnapshot): string => {
  const { settings, logs } = snap;

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
            `<span class="${logs.warnings > 0 ? 'warn' : 'dim'}">${logs.warnings} warn</span> · <span class="${logs.errors > 0 ? 'bad' : 'dim'}">${logs.errors} err</span>`
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
    'The machinery — settings, logs.',
    subTabs([
      { id: 'settings', label: 'Settings', body: settingsBody },
      { id: 'logs', label: 'Logs', body: logsBody }
    ])
  );
};

// ── status page ───────────────────────────────────────────────────────

/** In-page link that routes like a sidebar item — `page` or `page/subtab`. */
const navLink = (target: string, text: string): string =>
  `<span class="navlink" data-nav="${esc(target)}">${esc(text)} →</span>`;

const clearRow = (text: string): string =>
  `<div class="row"><span class="good" style="flex:none">✓</span><span class="grow dim">${esc(text)}</span></div>`;

/** The page behind the sidebar badge: every health signal, how it's derived,
 *  its current value, and where to act on it. */
const pageStatus = (snap: StatusSnapshot): string => {
  const { health, tasks, compile, logs, context } = snap;
  const plugin = snap.runtime.pluginName;
  const missing = context.staticImports.filter((item) => !item.present);

  const stats = statStrip([
    stat(health.overdue, 'overdue tasks', health.overdue ? 'bad' : 'good'),
    stat(health.pendingCompiles, 'pending compiles', health.pendingCompiles ? 'warn' : 'good'),
    stat(health.logErrors, 'log errors today', health.logErrors ? 'bad' : 'good'),
    stat(health.missingImports, 'missing imports', health.missingImports ? 'bad' : 'good'),
    stat(tasks.stale, 'stale · info only')
  ]);

  const overdueBody =
    hint('Open tasks whose due date has passed — read straight from each task file’s frontmatter.') +
    (tasks.overdueList.length
      ? tasks.overdueList.map((ref) => taskRow(ref, snap)).join('')
      : clearRow('Nothing past due.'));

  const pendingBody =
    hint(
      `Captured session days not yet absorbed into long-term memory — ${compile.sessionFiles} day-file(s) captured vs ${compile.ingested} compiled. Clear it with /${plugin}:sync or /${plugin}:knowledge-compile.`
    ) +
    (compile.pending
      ? `<div class="row"><span class="warn" style="flex:none">●</span><span class="grow">${compile.pending} session day(s) waiting</span>${navLink('brain/pipeline', 'see the pipeline')}</div>`
      : clearRow('Everything captured has been compiled.'));

  const logsBody =
    hint('ERROR-level lines the MCP server and hooks wrote to app.log today. Warnings don’t count.') +
    (logs.errors
      ? `<div class="row"><span class="bad" style="flex:none">●</span><span class="grow">${logs.errors} error(s) today${
          logs.lastError ? ` — last: <span class="dim">${esc(logs.lastError)}</span>` : ''
        }</span>${navLink('system/logs', 'open the log tail')}</div>`
      : `<div class="row"><span class="good" style="flex:none">✓</span><span class="grow dim">No errors logged today.</span>${navLink('system/logs', 'open the log tail')}</div>`);

  const importsBody =
    hint(
      'Files the CLAUDE.md @-import chain loads at session start — a missing one means a session boots without that context.'
    ) +
    (missing.length
      ? missing
          .map(
            (item) =>
              `<div class="row"><span class="bad" style="flex:none">✗</span><span class="grow">${esc(item.label)}</span>${navLink('brain/context', 'see context table')}</div>`
          )
          .join('')
      : clearRow('All static imports present.'));

  const staleBody =
    hint('Tasks not closed and untouched for 7+ days. Informational only — it never turns the badge amber.') +
    (tasks.stale
      ? `<div class="row"><span class="dim" style="flex:none">●</span><span class="grow">${tasks.stale} task(s) going stale</span>${navLink('tasks/attention', 'review them')}</div>`
      : clearRow('Nothing rotting.'));

  const issueCount = [health.overdue, health.pendingCompiles, health.logErrors, health.missingImports].filter(
    Boolean
  ).length;
  return page(
    'status',
    `Status <span class="accent">${health.ok ? '🟢' : '🟠'}</span>`,
    health.ok
      ? 'All systems nominal. The sidebar badge is green only when the four blocking signals below are all zero.'
      : `${issueCount} signal(s) need attention. The sidebar badge is green only when the four blocking signals below are all zero.`,
    stats +
      [
        section('Overdue tasks', String(health.overdue), overdueBody),
        section('Pending compiles', String(health.pendingCompiles), pendingBody),
        section('Log errors', String(health.logErrors), logsBody),
        section('Context imports', missing.length ? `${missing.length} missing` : 'all present', importsBody),
        section('Going stale', `${tasks.stale} · informational`, staleBody)
      ].join('')
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
      return `<div class="nav-item" data-nav="${item.id}"><span class="ico">${esc(icon)}</span>${esc(item.label)}</div>`;
    })
    .join('\n');

/** Sidebar health badge — green "all nominal" or amber with the issue list.
 *  Both states open the Status page, which explains every signal. */
const healthBadge = (snap: StatusSnapshot): string => {
  const { health } = snap;
  if (health.ok) {
    return `<span class="badge ok" data-nav="status" title="every health signal is clear — click for details"><span class="pulse"></span>all nominal</span>`;
  }
  const issues = [
    health.overdue && `${health.overdue} overdue`,
    health.pendingCompiles && `${health.pendingCompiles} pending`,
    health.logErrors && `${health.logErrors} errors`,
    health.missingImports && `${health.missingImports} missing`
  ].filter(Boolean);
  return `<span class="badge warn" data-nav="status" title="click for signal details"><span class="pulse"></span>${esc(issues.join(' · '))}</span>`;
};

const sidebarFoot = (snap: StatusSnapshot): string => {
  const { operator } = snap;
  const avatar = operator.avatar
    ? `<img src="${esc(operator.avatar)}" alt="${esc(operator.name || 'avatar')}">`
    : `<span class="op-fallback">👤</span>`;
  const card = `<div class="op-card" data-nav="profile">${avatar}<span><span class="op-name">${esc(operator.name || 'Operator')}</span><br><span class="op-tz">${esc(operator.timezone || '')}</span></span></div>`;
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
  scheduler: pageScheduler,
  capabilities: pageCapabilities,
  profile: pageProfile,
  persona: pagePersona,
  system: pageSystem,
  status: pageStatus
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
