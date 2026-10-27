/**
 * Pure renderer for attention: AttentionView in, a self-contained HTML page out, or just its lanes for the
 * dashboard's Today tab. Rows carry `data-row`/`data-cat` so the dashboard's project chips narrow them.
 */
import { jsonBlock } from '@/shared/json-block';
import { THEME_BLOCK } from '@/shared/theme';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  attentionData,
  formatDate,
  horizonLabel,
  taskStanding,
  type AttentionGroup,
  type AttentionItem,
  type AttentionMilestone,
  type AttentionTask,
  type AttentionView
} from './attention-data';
import { escapeHtml as esc, projectHue } from './html-primitives';

const TEMPLATE = readFileSync(new URL('attention.html', import.meta.url), 'utf-8');

/** The lanes' stylesheet, scoped under `.attentionview`; the dashboard inlines it too. */
export const ATTENTION_CSS = readFileSync(new URL('attention-lanes.css', import.meta.url), 'utf-8');

const fill = (slots: Record<string, string>): string =>
  TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => slots[token] ?? '');

const homeLink = (view: AttentionView, path: string, text: string): string =>
  `<a href="${esc(view.markdownUrl.replace('{path}', encodeURIComponent(resolve(view.home, path))))}">${esc(text)}</a>`;

const taskLink = (view: AttentionView, task: AttentionTask): string => homeLink(view, task.path, task.id);

interface RowOptions {
  mark: string;
  done?: boolean;
  from?: boolean;
}

const taskRow = (view: AttentionView, task: AttentionTask, options: RowOptions): string => {
  const meta = [
    taskLink(view, task),
    !view.project && `<span class="proj" style="--h:${projectHue(task.project, view.projectHues)}">${esc(task.project)}</span>`,
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

const taskList = (view: AttentionView, open: AttentionTask[], done: AttentionTask[], numbered = false): string =>
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

const itemRow = (item: AttentionItem): string => {
  const title = item.url
    ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a>`
    : esc(item.title);
  return `<li class="row" data-row data-cat="*"><span class="dot ${esc(item.tone)}"></span><span class="title">${title}</span>${
    item.detail ? `<span class="meta">${esc(item.detail)}</span>` : ''
  }</li>`;
};

const itemGroup = ({ label, empty: none, items, unavailable }: AttentionGroup): string =>
  `<div class="subhead">${esc(label)} · ${items.length}</div>${
    unavailable ? `<p class="unavailable">${esc(unavailable)}</p>` : ''
  }${items.length ? `<ul>${items.map(itemRow).join('')}</ul>` : unavailable ? '' : empty(esc(none))}`;

/** The slash command for this page; add takes its project from the ask, so it never names one. */
const command = (view: AttentionView, mode = ''): string =>
  `<code>${esc(['/attention', mode, mode === 'add' ? '' : view.project].filter(Boolean).join(' '))}</code>`;

const callout = (
  view: AttentionView,
  id: string,
  cls: string,
  label: string,
  tasks: AttentionTask[],
  mark: string,
  from: boolean
): string =>
  tasks.length
    ? `<div id="${id}" class="${cls}" data-rowgroup><h3>${esc(label)} · ${tasks.length}</h3><ol>${tasks
        .map((task) => taskRow(view, task, { mark, from }))
        .join('')}</ol></div>`
    : '';

const todaySection = (view: AttentionView): string => {
  const { today: open, carried } = view.lanes;
  const list =
    open.length || view.done.today.length
      ? taskList(view, open, view.done.today, true)
      : empty(`Nothing set for today. Run ${command(view, 'plan')} to pick up to three.`);
  const blocks =
    callout(view, 'attention-carried', 'carried', 'Carried over', carried, '↻', true) +
    callout(view, 'attention-due', 'carried due', 'Due, not planned', view.dueUnplanned, '!', false);
  const warn = carried.length || view.dueUnplanned.length ? ' warn' : '';
  return section(
    0,
    'attention-today',
    `now today${warn}`,
    laneHead('Today', open.length),
    goalList(view.dayGoals) + list + blocks
  );
};

const periodSection = (
  view: AttentionView,
  index: number,
  id: string,
  label: string,
  goals: string[],
  open: AttentionTask[],
  done: AttentionTask[],
  planned: AttentionView['planned']['week']
): string => {
  const tasks = open.length || done.length ? taskList(view, open, done) : '';
  const total = planned.open.length + planned.done.length;
  const body =
    goals.length || tasks || total
      ? goalList(goals) + progress(planned.done.length, total) + tasks
      : empty('Nothing planned yet.');
  return section(index, id, '', laneHead(label, open.length), body);
};

const milestoneRow = (view: AttentionView, milestone: AttentionMilestone): string => {
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

const roadmapSection = (view: AttentionView): string => {
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
    'attention-roadmap',
    slipped ? 'warn' : '',
    laneHead('Roadmap', milestones.length),
    list + notices.map((notice) => empty(esc(notice))).join('')
  );
};

const queueSection = (view: AttentionView): string => {
  if (!view.snapshot) {
    return section(
      4,
      'attention-queue',
      '',
      laneHead('Queue', 0),
      empty(`No pull yet. Run ${command(view)} to fetch what's waiting on you.`)
    );
  }
  const { groups } = view.snapshot;
  const count = groups.reduce((total, group) => total + group.items.length, 0);
  return groups.length
    ? section(4, 'attention-queue', 'items', laneHead('Queue', count), groups.map(itemGroup).join(''))
    : '';
};

const pinsSection = (view: AttentionView): string =>
  view.pins.length
    ? section(
        5,
        'attention-pins',
        'pins',
        laneHead('Pinned', view.pins.length),
        `<ul>${view.pins
          .map(
            (pin) =>
              `<li class="row" data-row data-cat="*"><span class="mark">${esc(pin.icon)}</span><span class="title">${homeLink(view, pin.path, pin.title)}</span></li>`
          )
          .join('')}</ul>`
      )
    : '';

/** The lanes on their timeline: Today, Roadmap, the week and month, the queue, the project's pins, then Later and Not planned. */
export const renderAttentionLanes = (view: AttentionView): string => {
  const monthName = formatDate(view.today, { month: 'long' });
  return [
    todaySection(view),
    roadmapSection(view),
    periodSection(
      view,
      2,
      'attention-week',
      'This week',
      view.weekGoals,
      view.lanes.week,
      view.done.week,
      view.planned.week
    ),
    periodSection(
      view,
      3,
      'attention-month',
      `This month · ${monthName}`,
      view.monthGoals,
      view.lanes.month,
      view.done.month,
      view.planned.month
    ),
    queueSection(view),
    pinsSection(view),
    view.lanes.later.length
      ? collapsible(6, 'Later', view.lanes.later.length, taskList(view, view.lanes.later, []))
      : '',
    view.unplanned.length
      ? collapsible(7, 'Not planned', view.unplanned.length, taskList(view, view.unplanned, []))
      : ''
  ].join('\n');
};

export const renderAttentionHtml = (view: AttentionView): string => {
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
      `${view.project ? `${view.scopeLabel} attention` : 'Attention'} · ${weekday} ${formatDate(view.today, { day: 'numeric', month: 'short' })}`
    ),
    ATTENTION_CSS,
    THEME: THEME_BLOCK,
    SCOPE: esc(view.scopeLabel),
    DATE_LONG: `<em>${esc(weekday)}</em>, ${esc(formatDate(view.today, { day: 'numeric', month: 'long' }))}`,
    SUBLINE: subline.join(''),
    BODY: renderAttentionLanes(view),
    FOOTER: `Rendered ${esc(view.generatedAt)} · ${command(view)} refreshes the queue · ${command(view, 'add')} takes something on · ${command(view, 'plan')} sets today`,
    DATA: jsonBlock('attention-data', attentionData(view), 'ATTENTION')
  });
};
