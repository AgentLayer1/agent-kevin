/**
 * Pure renderer for focus: FocusView in, a self-contained HTML page out, or just its lanes for the
 * dashboard's Today tab. Rows carry `data-row`/`data-cat` so the dashboard's project chips narrow them.
 */
import { jsonBlock } from '@/shared/json-block';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  focusData,
  formatDate,
  horizonLabel,
  taskStanding,
  type FocusGroup,
  type FocusItem,
  type FocusMilestone,
  type FocusTask,
  type FocusView
} from './focus-data';
import { escapeHtml as esc, nameHue } from './html-primitives';

const TEMPLATE = readFileSync(new URL('focus.html', import.meta.url), 'utf-8');

/** The lanes' stylesheet, scoped under `.focusview`; the dashboard inlines it too. */
export const FOCUS_CSS = readFileSync(new URL('focus-lanes.css', import.meta.url), 'utf-8');

const fill = (slots: Record<string, string>): string =>
  TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => slots[token] ?? '');

const taskLink = (view: FocusView, task: FocusTask): string =>
  `<a href="${esc(view.markdownUrl.replace('{path}', encodeURIComponent(resolve(view.home, task.path))))}">${esc(task.id)}</a>`;

interface RowOptions {
  mark: string;
  done?: boolean;
  from?: boolean;
}

const taskRow = (view: FocusView, task: FocusTask, options: RowOptions): string => {
  const meta = [
    taskLink(view, task),
    !view.project && `<span class="proj" style="--h:${nameHue(task.project)}">${esc(task.project)}</span>`,
    `<span class="pri ${esc(task.priority.toLowerCase())}">${esc(task.priority)}</span>`,
    options.from && `<span class="from">from ${esc(horizonLabel(task.horizon))}</span>`,
    task.due &&
      `<span class="${task.due < view.today ? 'late' : ''}">due ${esc(formatDate(task.due, { day: 'numeric', month: 'short' }))}</span>`,
    task.status === 'blocked' &&
      `<span class="blocked">blocked${task.blockedBy ? `: ${esc(task.blockedBy)}` : ''}</span>`
  ].filter((part): part is string => Boolean(part));
  return `<li class="row${options.done ? ' done' : ''}" data-row data-cat="${esc(task.project)}"><span class="mark">${options.mark}</span><span class="title">${esc(
    task.title
  )}</span><span class="meta">${meta.join('')}</span></li>`;
};

const taskList = (view: FocusView, open: FocusTask[], done: FocusTask[], numbered = false): string =>
  `<ol>${[
    ...open.map((task, index) => taskRow(view, task, { mark: numbered ? String(index + 1) : '·' })),
    ...done.map((task) => taskRow(view, task, { mark: '✓', done: true }))
  ].join('')}</ol>`;

const laneHead = (label: string, count: number): string =>
  `<div class="lane-head"><h2>${esc(label)}</h2><span class="count">${count}</span><span class="rule"></span></div>`;

const section = (index: number, id: string, cls: string, head: string, inner: string): string =>
  `<section id="${id}" class="${cls}" style="--i:${index}" data-rowgroup>${head}${inner}</section>`;

const collapsible = (index: number, label: string, count: number, inner: string): string =>
  `<section style="--i:${index}"><details><summary>${laneHead(label, count)}</summary>${inner}</details></section>`;

const empty = (html: string): string => `<p class="empty">${html}</p>`;

const goalList = (goals: string[]): string =>
  goals.length ? `<ul class="goals">${goals.map((goal) => `<li>${esc(goal)}</li>`).join('')}</ul>` : '';

const progress = (done: number, total: number): string =>
  total
    ? `<div class="progress"><span class="bar"><i style="width:${Math.round((done / total) * 100)}%"></i></span><span>${done} of ${total} done</span></div>`
    : '';

const itemRow = (item: FocusItem): string => {
  const title = item.url
    ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a>`
    : esc(item.title);
  return `<li class="row" data-row data-cat="*"><span class="dot ${esc(item.tone)}"></span><span class="title">${title}</span>${
    item.detail ? `<span class="meta">${esc(item.detail)}</span>` : ''
  }</li>`;
};

const itemGroup = ({ label, empty: none, items, unavailable }: FocusGroup): string =>
  `<div class="subhead">${esc(label)} · ${items.length}</div>${
    unavailable ? `<p class="unavailable">${esc(unavailable)}</p>` : ''
  }${items.length ? `<ul>${items.map(itemRow).join('')}</ul>` : unavailable ? '' : empty(esc(none))}`;

/** The slash command for this page; add takes its project from the ask, so it never names one. */
const command = (view: FocusView, mode = ''): string =>
  `<code>${esc(['/focus', mode, mode === 'add' ? '' : view.project].filter(Boolean).join(' '))}</code>`;

const callout = (
  view: FocusView,
  id: string,
  cls: string,
  label: string,
  tasks: FocusTask[],
  mark: string,
  from: boolean
): string =>
  tasks.length
    ? `<div id="${id}" class="${cls}" data-rowgroup><h3>${esc(label)} · ${tasks.length}</h3><ol>${tasks
        .map((task) => taskRow(view, task, { mark, from }))
        .join('')}</ol></div>`
    : '';

const todaySection = (view: FocusView): string => {
  const { today: open, carried } = view.lanes;
  const list =
    open.length || view.done.today.length
      ? taskList(view, open, view.done.today, true)
      : empty(`Nothing set for today. Run ${command(view, 'plan')} to pick up to three.`);
  const blocks =
    callout(view, 'focus-carried', 'carried', 'Carried over', carried, '↻', true) +
    callout(view, 'focus-due', 'carried due', 'Due, not planned', view.dueUnplanned, '!', false);
  const warn = carried.length || view.dueUnplanned.length ? ' warn' : '';
  return section(0, 'focus-today', `now today${warn}`, laneHead('Today', open.length), list + blocks);
};

const periodSection = (
  view: FocusView,
  index: number,
  id: string,
  label: string,
  goals: string[],
  open: FocusTask[],
  done: FocusTask[],
  planned: FocusView['planned']['week']
): string => {
  const tasks = open.length || done.length ? taskList(view, open, done) : '';
  const total = planned.open.length + planned.done.length;
  const body =
    goals.length || tasks || total
      ? goalList(goals) + progress(planned.done.length, total) + tasks
      : empty('Nothing planned yet.');
  return section(index, id, '', laneHead(label, open.length), body);
};

const milestoneRow = (view: FocusView, milestone: FocusMilestone): string => {
  const slipped = milestone.state === 'slipped';
  const meta = [
    `<span>${esc(milestone.section)}</span>`,
    `<span>${milestone.done} of ${milestone.total} done</span>`,
    slipped &&
      milestone.window &&
      `<span class="late">window ended ${esc(formatDate(milestone.window.end, { day: 'numeric', month: 'short' }))}</span>`,
    ...milestone.tasks.map((task) => `<span>${taskLink(view, task)} ${esc(taskStanding(task, view.today))}</span>`),
    milestone.gap && '<span class="blocked">no open task behind it</span>'
  ].filter((part): part is string => Boolean(part));
  const doing = milestone.inProgress.map((text) => `<div class="doing">⏳ ${esc(text)}</div>`).join('');
  const chip = milestone.chip ? `<span class="chip">${esc(milestone.chip)}</span>` : '';
  return `<li class="row${slipped ? ' slipped' : ''}" data-row data-cat="*"><span class="mark">${slipped ? '!' : '◆'}</span><span class="title">${chip}${esc(
    milestone.title
  )}</span><span class="meta">${meta.join('')}</span>${doing ? `<div class="doings">${doing}</div>` : ''}</li>`;
};

const roadmapSection = (view: FocusView): string => {
  const { milestones, notices } = view.roadmap;
  if (!milestones.length && !notices.length) {
    return '';
  }
  const slipped = milestones.filter((milestone) => milestone.state === 'slipped').length;
  const list = milestones.length
    ? `<ol class="roadmap">${milestones.map((milestone) => milestoneRow(view, milestone)).join('')}</ol>`
    : empty('Nothing on the roadmap is in flight.');
  return section(
    1,
    'focus-roadmap',
    slipped ? 'warn' : '',
    laneHead('Roadmap', milestones.length),
    list + notices.map((notice) => empty(esc(notice))).join('')
  );
};

const queueSection = (view: FocusView): string => {
  if (!view.snapshot) {
    return section(
      4,
      'focus-queue',
      '',
      laneHead('Queue', 0),
      empty(`No pull yet. Run ${command(view)} to fetch what's waiting on you.`)
    );
  }
  const { groups } = view.snapshot;
  const count = groups.reduce((total, group) => total + group.items.length, 0);
  return groups.length
    ? section(4, 'focus-queue', 'items', laneHead('Queue', count), groups.map(itemGroup).join(''))
    : '';
};

/** The lanes on their timeline: Today, Roadmap, the week and month, the queue, then Later and Not planned. */
export const renderFocusLanes = (view: FocusView): string => {
  const monthName = formatDate(view.today, { month: 'long' });
  return [
    todaySection(view),
    roadmapSection(view),
    periodSection(
      view,
      2,
      'focus-week',
      'This week',
      view.weekGoals,
      view.lanes.week,
      view.done.week,
      view.planned.week
    ),
    periodSection(
      view,
      3,
      'focus-month',
      `This month · ${monthName}`,
      view.monthGoals,
      view.lanes.month,
      view.done.month,
      view.planned.month
    ),
    queueSection(view),
    view.lanes.later.length
      ? collapsible(5, 'Later', view.lanes.later.length, taskList(view, view.lanes.later, []))
      : '',
    view.unplanned.length
      ? collapsible(6, 'Not planned', view.unplanned.length, taskList(view, view.unplanned, []))
      : ''
  ].join('\n');
};

export const renderFocusHtml = (view: FocusView): string => {
  const weekNumber = Number(view.week.slice(6));
  const monthName = formatDate(view.today, { month: 'long' });
  const weekOpen = view.planned.week.open.length;
  const weekDone = view.planned.week.done.length;
  const subline = [
    `<span>Week <b>${weekNumber}</b> · ${esc(monthName)}</span>`,
    `<span><b>${view.lanes.today.length}</b> today</span>`,
    view.lanes.carried.length ? `<span><b>${view.lanes.carried.length}</b> carried over</span>` : '',
    `<span><b>${weekDone}/${weekOpen + weekDone}</b> this week</span>`,
    view.queuePulled
      ? `<span>queue pulled ${esc([view.queuePulled.day, view.queuePulled.time].filter(Boolean).join(' · '))}</span>`
      : ''
  ].filter(Boolean);
  const weekday = formatDate(view.today, { weekday: 'long' });
  return fill({
    TITLE: esc(
      `${view.project ? `${view.scopeLabel} focus` : 'Focus'} · ${weekday} ${formatDate(view.today, { day: 'numeric', month: 'short' })}`
    ),
    FOCUS_CSS,
    SCOPE: esc(view.scopeLabel),
    DATE_LONG: `<em>${esc(weekday)}</em>, ${esc(formatDate(view.today, { day: 'numeric', month: 'long' }))}`,
    SUBLINE: subline.join(''),
    BODY: renderFocusLanes(view),
    FOOTER: `Rendered ${esc(view.generatedAt)} · ${command(view)} refreshes the queue · ${command(view, 'add')} takes something on · ${command(view, 'plan')} sets today`,
    DATA: jsonBlock('focus-data', focusData(view), 'FOCUS')
  });
};
