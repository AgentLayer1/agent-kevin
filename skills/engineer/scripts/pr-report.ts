#!/usr/bin/env bun
/**
 * Render a PR review or replies report from one data file.
 *   bun pr-report.ts card <data.json>              validate, print the report_write arguments (card body included) as JSON
 *   bun pr-report.ts write <data.json> <report.md>  write <report>.html beside the saved card and re-render the card
 *   bun pr-report.ts check <report.html>            re-validate a page
 * Every command parses the diagrams, so run it with NODE_PATH pointed at the plugin's
 * mcp-server/node_modules.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { isRecord, isScriptSafe, jsonBlock, readJsonBlock } from '../../../mcp-server/src/shared/json-block';

export const BLOCK_ID = 'pr-report-data';
export const PAGE_TOKEN = '{{pr-report-page}}';
export const TEMPLATE_PATH = join(import.meta.dir, '..', 'templates', 'pr-report.html');

const KINDS = ['review', 'replies'];
const VERDICTS = ['approve', 'approve-with-fixes', 'needs-discussion', 'changes-requested', 'do-not-merge'];
const RISKS = ['S', 'M', 'L', 'XL'];
const CLASSES = ['risk', 'logic', 'mechanical'];
const SEVERITIES = ['blocker', 'fix-before-merge', 'nit', 'question'];
const INTRODUCED = ['yes', 'made-worse', 'pre-existing'];
const LANES = ['correctness', 'invariants', 'security', 'regressions', 'conventions', 'tests', 'hygiene', 'generated-code', 'performance', 'case-against', 'gate'];
const CRITICAL_LANES = ['invariants', 'security'];
const ASKED = ['met', 'not-met', 'untested'];
const DISPOSITIONS = ['confirmed', 'question', 'false-positive', 'already-fixed', 'out-of-scope'];
const RESULTS = ['pass', 'fail', 'not-run', 'partial', 'info'];
const WHERE = ['inline', 'conversation', 'review'];
const STATUSES = ['to-post', 'follow-up', 'posted'];
const PATH = /^[^\s:`]+$/;
const LINES = /^(\d+)(?:-(\d+))?$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const COMMENT_ID = /^(discussion_r|issuecomment-|pullrequestreview-)\d+$/;
const LOOK_LIMIT = 5;

const KEYS = {
  common: ['kind', 'pr', 'stack', 'summary', 'checks', 'sinceLast', 'prior', 'draft'],
  review: ['verdict', 'risk', 'riskWhy', 'executed', 'lookAt', 'skim', 'decisions', 'asked', 'explanation', 'flows', 'areas', 'behavior', 'holdQuestions', 'caseAgainst', 'findings', 'files', 'bots', 'verifiedClean', 'summaryComment', 'noticed', 'dropped', 'notChecked'],
  replies: ['threads', 'ownFindings', 'commits', 'resolveOnly', 'stillOpen'],
  pr: ['number', 'title', 'author', 'repo', 'head', 'base', 'adds', 'dels'],
  finding: ['id', 'severity', 'title', 'anchor', 'lanes', 'principle', 'introduced', 'failure', 'evidence', 'comment'],
  file: ['path', 'class', 'concern', 'summary', 'adds', 'dels', 'hunks'],
  bot: ['bot', 'anchor', 'claim', 'disposition', 'finding', 'reason', 'reply'],
  dropped: ['anchor', 'lanes', 'claim', 'reason'],
  thread: ['id', 'url', 'where', 'anchor', 'reviewer', 'bot', 'outdated', 'pr', 'point', 'quote', 'status', 'reply']
};

const VERDICT_LABEL: Record<string, string> = {
  approve: '✅ Approve',
  'approve-with-fixes': '✅ Approve with fixes',
  'needs-discussion': '💬 Needs discussion',
  'changes-requested': '🟠 Changes requested',
  'do-not-merge': '🔴 Do not merge'
};
const SEVERITY_ICON: Record<string, string> = { blocker: '🔴', 'fix-before-merge': '🟠', nit: '🟡', question: '❓' };
const STATUS_LABEL: Record<string, string> = { 'to-post': 'To post', 'follow-up': 'Follow-up', posted: 'Posted' };

export interface ReportCheck {
  errors: string[];
  warnings: string[];
  diagrams: { flow: string; source: string }[];
}

type Row = Record<string, unknown>;

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const rows = (value: unknown): Row[] => list(value).filter(isRecord);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const textErrors = (record: Row, keys: string[], path: string): string[] =>
  keys.filter((key) => !isText(record[key])).map((key) => `${path}.${key} must be non-empty text`);

const oneLineErrors = (record: Row, keys: string[], path: string): string[] =>
  keys.filter((key) => text(record[key]).includes('\n')).map((key) => `${path}.${key} must be one line`);

const linesOk = (value: string): boolean => {
  const match = LINES.exec(value);
  return match !== null && (match[2] === undefined || Number(match[1]) <= Number(match[2]));
};

const anchorPath = (anchor: string): string => anchor.split(':')[0];

const anchorErrors = (value: unknown, path: string, allowPath = false): string[] => {
  const anchor = text(value);
  const colon = anchor.indexOf(':');
  const ok = colon === -1 ? allowPath && PATH.test(anchor) : PATH.test(anchor.slice(0, colon)) && linesOk(anchor.slice(colon + 1));
  return ok ? [] : [`${path} must be "path:line" or "path:start-end" with start ≤ end${allowPath ? ' (or a bare path)' : ''}, got ${JSON.stringify(value)}`];
};

const optionalAnchor = (value: unknown, path: string): string[] => (value === undefined ? [] : anchorErrors(value, path));

const enumErrors = (value: unknown, allowed: string[], path: string): string[] =>
  typeof value === 'string' && allowed.includes(value) ? [] : [`${path} must be one of ${allowed.join(' | ')}, got ${JSON.stringify(value)}`];

const optionalEnum = (value: unknown, allowed: string[], path: string): string[] =>
  value === undefined ? [] : enumErrors(value, allowed, path);

const isLane = (value: unknown): boolean => typeof value === 'string' && (LANES.includes(value) || /^bot:\S+$/.test(value));

const lanesErrors = (value: unknown, path: string): string[] =>
  value === undefined
    ? []
    : !Array.isArray(value) || value.length === 0
      ? [`${path} must be a non-empty list`]
      : value.flatMap((lane, index) => (isLane(lane) ? [] : [`${path}[${index}] must be one of ${LANES.join(' | ')} | bot:<login>, got ${JSON.stringify(lane)}`]));

const rowErrors = (value: unknown, path: string, check: (row: Row, at: string) => string[]): string[] =>
  value === undefined
    ? []
    : !Array.isArray(value)
      ? [`${path} must be a list`]
      : value.flatMap((row, index) => (isRecord(row) ? check(row, `${path}[${index}]`) : [`${path}[${index}] must be an object`]));

const textListErrors = (value: unknown, path: string): string[] =>
  value === undefined
    ? []
    : !Array.isArray(value)
      ? [`${path} must be a list`]
      : value.flatMap((item, index) => (isText(item) ? [] : [`${path}[${index}] must be non-empty text`]));

const prOf = (data: Row): Row => (isRecord(data.pr) ? data.pr : {});

// A misspelled key would otherwise drop its section from the page without a word.
const keyErrors = (record: Row, allowed: string[], path: string): string[] =>
  Object.keys(record)
    .filter((key) => !allowed.includes(key))
    .map((key) => `${path}${path ? '.' : ''}${key} is not a field${key === 'lane' ? ' (use lanes, a list)' : ''}`);

const optionalTextErrors = (record: Row, keys: string[], path: string): string[] =>
  keys.filter((key) => record[key] !== undefined && !isText(record[key])).map((key) => `${path}${path ? '.' : ''}${key} must be text`);

const countErrors = (record: Row, keys: string[], path: string): string[] =>
  keys.filter((key) => record[key] !== undefined && !(Number.isInteger(record[key]) && Number(record[key]) >= 0)).map((key) => `${path}.${key} must be a whole number`);

const severityCount = (data: Row, severity: string): number => rows(data.findings).filter((finding) => finding.severity === severity).length;

const verdictErrors = (data: Row): string[] => {
  const blockers = severityCount(data, 'blocker');
  const fixes = severityCount(data, 'fix-before-merge');
  const questions = severityCount(data, 'question');
  const rule: Record<string, [boolean, string]> = {
    approve: [blockers + fixes + questions === 0, 'approve leaves no blocker, fix-before-merge or question'],
    'approve-with-fixes': [blockers + fixes === 0, 'approve-with-fixes leaves no blocker or fix-before-merge'],
    'needs-discussion': [blockers + fixes === 0, 'needs-discussion means nothing is broken: no blocker or fix-before-merge'],
    'changes-requested': [blockers + fixes > 0, 'changes-requested needs a blocker or fix-before-merge finding'],
    'do-not-merge': [blockers > 0, 'do-not-merge needs a blocker']
  };
  const [ok, message] = rule[text(data.verdict)] ?? [true, ''];
  return ok ? [] : [`verdict: ${message}`];
};

const commonErrors = (data: Row): string[] => {
  const pr = isRecord(data.pr) ? data.pr : null;
  return [
    ...keyErrors(data, [...KEYS.common, ...(data.kind === 'replies' ? KEYS.replies : KEYS.review)], ''),
    ...(pr ? [...textErrors(pr, ['title', 'author', 'head', 'base', 'repo'], 'pr'), ...oneLineErrors(pr, ['title'], 'pr'), ...keyErrors(pr, KEYS.pr, 'pr'), ...countErrors(pr, ['adds', 'dels'], 'pr')] : ['pr must be an object']),
    ...(pr && !Number.isInteger(pr.number) ? ['pr.number must be an integer'] : []),
    ...(pr && isText(pr.repo) && !REPO.test(pr.repo) ? [`pr.repo must be owner/name, got ${JSON.stringify(pr.repo)}`] : []),
    ...(isText(data.summary) ? [] : ['summary must be non-empty text']),
    ...(data.draft === undefined || typeof data.draft === 'boolean' ? [] : ['draft must be true or false']),
    ...rowErrors(data.stack, 'stack', (row, at) => [
      ...(Number.isInteger(row.number) ? [] : [`${at}.number must be an integer`]),
      ...textErrors(row, ['title'], at),
      ...oneLineErrors(row, ['title'], at)
    ]),
    ...rowErrors(data.checks, 'checks', (row, at) => [...textErrors(row, ['check'], at), ...enumErrors(row.result, RESULTS, `${at}.result`)]),
    ...textListErrors(data.sinceLast, 'sinceLast'),
    ...textListErrors(data.prior, 'prior')
  ];
};

const reviewErrors = (data: Row): string[] => {
  const findings = rows(data.findings);
  const findingIds = findings.map((finding) => finding.id);
  const filePaths = rows(data.files).map((file) => text(file.path));
  const inFiles = (anchor: unknown, at: string): string[] => (isText(anchor) && !filePaths.includes(anchorPath(anchor)) ? [`${at}.anchor names a file missing from files`] : []);
  return [
    ...enumErrors(data.verdict, VERDICTS, 'verdict'),
    ...verdictErrors(data),
    ...enumErrors(data.risk, RISKS, 'risk'),
    ...optionalTextErrors(data, ['riskWhy', 'executed', 'skim', 'explanation', 'summaryComment'], ''),
    ...(list(data.lookAt).length ? [] : ['lookAt needs at least one hunk to read']),
    ...rowErrors(data.lookAt, 'lookAt', (row, at) => [...anchorErrors(row.anchor, `${at}.anchor`), ...inFiles(row.anchor, at), ...textErrors(row, ['why'], at)]),
    ...rowErrors(data.decisions, 'decisions', (row, at) => [...textErrors(row, ['decision', 'picks'], at), ...anchorErrors(row.anchor, `${at}.anchor`), ...inFiles(row.anchor, at)]),
    ...rowErrors(data.asked, 'asked', (row, at) => [
      ...textErrors(row, ['criterion'], at),
      ...enumErrors(row.status, ASKED, `${at}.status`),
      ...optionalAnchor(row.anchor, `${at}.anchor`)
    ]),
    ...(isText(data.explanation) || list(data.flows).length ? [] : ['How it works needs an explanation or at least one flow']),
    ...rowErrors(data.flows, 'flows', (row, at) => [
      ...textErrors(row, ['title', 'diagram'], at),
      ...rowErrors(row.steps, `${at}.steps`, (step, stepAt) => [...textErrors(step, ['text'], stepAt), ...optionalAnchor(step.anchor, `${stepAt}.anchor`)])
    ]),
    ...rowErrors(data.areas, 'areas', (row, at) => textErrors(row, ['area', 'what', 'why'], at)),
    ...rowErrors(data.behavior, 'behavior', (row, at) => textErrors(row, ['case', 'before', 'after'], at)),
    ...textListErrors(data.holdQuestions, 'holdQuestions'),
    ...(data.caseAgainst === undefined
      ? []
      : isRecord(data.caseAgainst)
        ? textErrors(data.caseAgainst, ['strongest', 'threeMonths', 'cut'], 'caseAgainst')
        : ['caseAgainst must be an object']),
    ...rowErrors(data.findings, 'findings', (row, at) => [
      ...(Number.isInteger(row.id) ? [] : [`${at}.id must be an integer`]),
      ...enumErrors(row.severity, SEVERITIES, `${at}.severity`),
      ...textErrors(row, ['title', 'comment'], at),
      ...oneLineErrors(row, ['title'], at),
      ...anchorErrors(row.anchor, `${at}.anchor`, row.severity === 'nit'),
      ...inFiles(row.anchor, at),
      ...(row.lanes === undefined ? [`${at}.lanes must list every source that raised it`] : lanesErrors(row.lanes, `${at}.lanes`)),
      ...keyErrors(row, KEYS.finding, at),
      ...optionalEnum(row.introduced, INTRODUCED, `${at}.introduced`),
      ...(row.severity === 'blocker' || row.severity === 'fix-before-merge' ? textErrors(row, ['failure', 'evidence'], at) : [])
    ]),
    ...(new Set(findingIds).size === findingIds.length ? [] : ['findings ids must be unique']),
    ...(list(data.files).length ? [] : ['files needs every file on the coverage checklist']),
    ...rowErrors(data.files, 'files', (row, at) => [
      ...textErrors(row, ['path', 'concern', 'summary'], at),
      ...(isText(row.path) && !PATH.test(row.path) ? [`${at}.path must have no spaces, colons or backticks`] : []),
      ...enumErrors(row.class, CLASSES, `${at}.class`),
      ...keyErrors(row, KEYS.file, at),
      ...countErrors(row, ['adds', 'dels'], at),
      ...rowErrors(row.hunks, `${at}.hunks`, (hunk, hunkAt) => [
        ...textErrors(hunk, ['lines', 'text'], hunkAt),
        ...(isText(hunk.lines) && !linesOk(hunk.lines) ? [`${hunkAt}.lines must be "line" or "start-end" with start ≤ end, got ${JSON.stringify(hunk.lines)}`] : [])
      ])
    ]),
    ...rowErrors(data.bots, 'bots', (row, at) => [
      ...textErrors(row, ['bot', 'claim'], at),
      ...oneLineErrors(row, ['bot', 'claim'], at),
      ...enumErrors(row.disposition, DISPOSITIONS, `${at}.disposition`),
      ...optionalAnchor(row.anchor, `${at}.anchor`),
      ...(row.finding === undefined || findingIds.includes(row.finding) ? [] : [`${at}.finding points at no finding id`]),
      ...(row.disposition === 'confirmed' && row.finding === undefined ? [`${at}.finding must name the finding a confirmed bot comment became`] : []),
      ...(row.disposition === 'false-positive' && !isText(row.reason) ? [`${at}.reason must say why it is a false positive`] : []),
      ...(row.disposition === 'false-positive' && !isText(row.reply) ? [`${at}.reply must give the operator a reply to paste on the bot's thread`] : []),
      ...keyErrors(row, KEYS.bot, at)
    ]),
    ...textListErrors(data.verifiedClean, 'verifiedClean'),
    ...rowErrors(data.noticed, 'noticed', (row, at) => [...anchorErrors(row.anchor, `${at}.anchor`), ...textErrors(row, ['text'], at)]),
    ...rowErrors(data.dropped, 'dropped', (row, at) => [
      ...anchorErrors(row.anchor, `${at}.anchor`),
      ...textErrors(row, ['claim', 'reason'], at),
      ...lanesErrors(row.lanes, `${at}.lanes`),
      ...keyErrors(row, KEYS.dropped, at)
    ]),
    ...textListErrors(data.notChecked, 'notChecked')
  ];
};

const repliesErrors = (data: Row): string[] => {
  const pr = prOf(data);
  return [
    ...rowErrors(data.threads, 'threads', (row, at) => {
      const number = row.pr ?? pr.number;
      const url = `https://github.com/${text(pr.repo)}/pull/${String(number)}#${text(row.id)}`;
      return [
        ...textErrors(row, ['id', 'url', 'reviewer', 'point', 'quote'], at),
        ...oneLineErrors(row, ['reviewer', 'point'], at),
        ...(isText(row.id) && !COMMENT_ID.test(row.id) ? [`${at}.id must be the comment's URL fragment (discussion_r…, issuecomment-…, pullrequestreview-…), got ${JSON.stringify(row.id)}`] : []),
        ...(isText(row.url) && row.url !== url ? [`${at}.url must be ${url}, got ${JSON.stringify(row.url)}`] : []),
        ...(row.pr === undefined || Number.isInteger(row.pr) ? [] : [`${at}.pr must be an integer`]),
        ...enumErrors(row.where, WHERE, `${at}.where`),
        ...enumErrors(row.status, STATUSES, `${at}.status`),
        ...optionalAnchor(row.anchor, `${at}.anchor`),
        ...(row.status === 'posted' || isText(row.reply) ? [] : [`${at}.reply must be non-empty text unless the thread is posted`]),
        ...keyErrors(row, KEYS.thread, at)
      ];
    }),
    ...rowErrors(data.ownFindings, 'ownFindings', (row, at) => [
      ...textErrors(row, ['title', 'detail'], at),
      ...oneLineErrors(row, ['title'], at),
      ...anchorErrors(row.anchor, `${at}.anchor`)
    ]),
    ...rowErrors(data.commits, 'commits', (row, at) => [...textErrors(row, ['subject'], at), ...oneLineErrors(row, ['subject'], at)]),
    ...rowErrors(data.resolveOnly, 'resolveOnly', (row, at) => [...textErrors(row, ['topic', 'why'], at), ...optionalAnchor(row.anchor, `${at}.anchor`)]),
    ...textListErrors(data.stillOpen, 'stillOpen')
  ];
};

const pageOrderIds = (data: Row): unknown[] =>
  SEVERITIES.flatMap((severity) => rows(data.findings).filter((finding) => finding.severity === severity)).map((finding) => finding.id);

/**
 * Shape and safety checks for either kind; diagrams are returned for the caller to parse.
 */
export const validate = (data: unknown): ReportCheck => {
  if (!isRecord(data)) {
    return { errors: ['the report data must be an object'], warnings: [], diagrams: [] };
  }
  const looks = list(data.lookAt).length;
  return {
    errors: [
      ...enumErrors(data.kind, KINDS, 'kind'),
      ...commonErrors(data),
      ...(data.kind === 'review' ? reviewErrors(data) : []),
      ...(data.kind === 'replies' ? repliesErrors(data) : [])
    ],
    warnings: [
      ...(looks > LOOK_LIMIT ? [`lookAt has ${looks} hunks; ${LOOK_LIMIT} at most keeps it a reading guide`] : []),
      ...(data.verdict === 'approve' && !list(data.verifiedClean).length ? ['an approve needs a verifiedClean list saying what was checked'] : []),
      ...(pageOrderIds(data).every((id, index) => id === index + 1) ? [] : ['findings ids should run 1, 2, 3… in page order: blockers, fix-before-merge, nits, then questions'])
    ],
    diagrams: rows(data.flows)
      .filter((flow) => isText(flow.diagram))
      .map((flow) => ({ flow: text(flow.title), source: text(flow.diagram) }))
  };
};

/**
 * Validate a written page: the block must exist, parse, and stay script-safe.
 */
export const checkPage = (html: string): ReportCheck => {
  const read = readJsonBlock(html, BLOCK_ID);
  if (!read) {
    return { errors: [`no <script id="${BLOCK_ID}"> block`], warnings: [], diagrams: [] };
  }
  if (read.kind === 'invalid') {
    return { errors: [`${BLOCK_ID} is not valid JSON: ${read.error}`], warnings: [], diagrams: [] };
  }
  const result = validate(read.data);
  return isScriptSafe(read.raw) ? result : { ...result, errors: ['the data block holds an unescaped "</" or "<!--"', ...result.errors] };
};

const escapeMd = (value: string): string => value.replace(/([[\]<>`\\])/g, '\\$1').replace(/%%/g, '%\\%');

const md = (value: unknown): string => escapeMd(text(value).replace(/\s*\n\s*/g, ' '));

const code = (value: unknown): string | undefined => (isText(value) ? `\`${value}\`` : undefined);

const line = (parts: (string | false | undefined)[]): string => parts.filter((part): part is string => Boolean(part)).join(' · ');

const section = (title: string, lines: string[]): string[] => (lines.length ? ['', `## ${title}`, '', ...lines] : []);

const bullets = (items: unknown): string[] => list(items).map((item) => `- ${md(item)}`);

const reviewCard = (data: Row): string[] => {
  const findings = rows(data.findings);
  const bySeverity = (severities: string[]) =>
    findings
      .filter((finding) => severities.includes(text(finding.severity)))
      .map((finding) => `- ${SEVERITY_ICON[text(finding.severity)]} #${String(finding.id)} ${md(finding.title)} · ${code(finding.anchor)}`);
  return [
    `**Verdict** ${VERDICT_LABEL[text(data.verdict)] ?? md(data.verdict)} · **Risk** ${md(data.risk)} · **Page** [open the review](${PAGE_TOKEN})`,
    ...section('Findings', bySeverity(['blocker', 'fix-before-merge', 'nit'])),
    ...section('Questions for the author', bySeverity(['question'])),
    ...section(
      'Bot comments',
      rows(data.bots).map(
        (bot) => `- ${line([md(bot.bot), code(bot.anchor), text(bot.disposition), bot.finding === undefined ? undefined : `#${String(bot.finding)}`])}: ${md(bot.claim)}`
      )
    ),
    ...section('Not checked', bullets(data.notChecked))
  ];
};

const repliesCard = (data: Row): string[] => {
  const threads = rows(data.threads);
  const count = (status: string) => threads.filter((thread) => thread.status === status).length;
  return [
    `**Threads** ${count('to-post')} to post · ${count('follow-up')} follow-up · ${count('posted')} posted · ${list(data.resolveOnly).length} resolve only · **Page** [open the replies](${PAGE_TOKEN})`,
    ...section(
      'Threads',
      threads.map(
        (thread) => `- ${line([STATUS_LABEL[text(thread.status)], md(thread.reviewer), md(thread.point), code(thread.anchor)])} · [${text(thread.id)}](${text(thread.url)})`
      )
    ),
    ...section(
      'Found on my own',
      rows(data.ownFindings).map((finding) => `- ${md(finding.title)} · ${code(finding.anchor)}`)
    ),
    ...section('Still open', bullets(data.stillOpen))
  ];
};

/**
 * The markdown index card `report_write` saves; the page link stays a token until `write` runs.
 */
export const renderCard = (data: Row): string => {
  const pr = prOf(data);
  const title = `PR #${String(pr.number)}${data.kind === 'replies' ? ' replies' : ''}: ${md(pr.title)}`;
  const body = data.kind === 'replies' ? repliesCard(data) : reviewCard(data);
  const quote = text(data.summary)
    .split('\n')
    .map((part) => `> ${escapeMd(part).replace(/^#/, '\\#')}`.trimEnd())
    .join('\n');
  const draft = data.draft === true ? ['**Draft:** a quick or partial pass; the local gates did not run.', ''] : [];
  return [`# ${title}`, '', quote, '', ...draft, ...body, ...section('Since the last run', bullets(data.sinceLast)), ''].join('\n');
};

/**
 * The report status `report_write` records, derived from the data so it cannot disagree with it.
 */
export const statusOf = (data: Row): string => {
  if (data.draft === true) {
    return 'draft';
  }
  if (data.kind === 'replies') {
    const open = rows(data.threads).some((thread) => thread.status !== 'posted') || list(data.ownFindings).length > 0;
    return open ? 'findings' : 'clean';
  }
  const blockers = rows(data.findings).filter((finding) => finding.severity === 'blocker');
  if (blockers.some((finding) => list(finding.lanes).some((lane) => CRITICAL_LANES.includes(text(lane))))) {
    return 'critical';
  }
  return data.verdict === 'approve' ? 'clean' : 'findings';
};

/**
 * Everything `report_write` needs that the data decides; the playbook adds category, slug, title, skill, tags and supersedes.
 */
export const reportArgs = (data: Row): Row => {
  const pr = prOf(data);
  const blockers = rows(data.findings).filter((finding) => finding.severity === 'blocker').length;
  return {
    body: renderCard(data),
    summary: text(data.summary).replace(/\s+/g, ' ').trim(),
    status: statusOf(data),
    extra: {
      pr: pr.number,
      author: pr.author,
      head: pr.head,
      base: pr.base,
      mode: data.kind === 'replies' ? 'reply' : 'review',
      ...(data.kind === 'review' ? { verdict: data.verdict, blockers } : {})
    }
  };
};

/**
 * The template with its sample data block swapped for this report's data and its title set.
 */
export const renderPage = (template: string, data: Row): string => {
  const pr = prOf(data);
  const title = `PR #${String(pr.number)}${data.kind === 'replies' ? ' replies' : ''} — ${text(pr.title)}`;
  const escaped = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return template
    .replace(new RegExp(`<script\\b[^>]*\\bid="${BLOCK_ID}"[^>]*>[\\s\\S]*?</script>`), () => jsonBlock(BLOCK_ID, data, 'data'))
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escaped}</title>`);
};

/**
 * Why a saved card can't take this data, or null when it can: another PR or kind, or a status the data has since changed.
 */
export const cardMismatch = (saved: string, data: Row): string | null => {
  const front = /^---\n([\s\S]*?)\n---\n/.exec(saved)?.[1] ?? '';
  const field = (key: string): string => (new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(front)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
  const args = reportArgs(data);
  const extra = isRecord(args.extra) ? args.extra : {};
  if (field('pr') !== String(extra.pr) || field('mode') !== String(extra.mode)) {
    return `the card is PR #${field('pr') || '?'} (${field('mode') || '?'}), but the data is PR #${String(extra.pr)} (${String(extra.mode)})`;
  }
  const changed = [
    ['status', String(args.status)],
    ...(data.kind === 'review' ? [['verdict', String(extra.verdict)], ['blockers', String(extra.blockers)]] : [])
  ].filter(([key, value]) => field(key) !== value);
  return changed.length
    ? `the card was saved with ${changed.map(([key]) => `${key}: ${field(key)}`).join(', ')}, but the data now gives ${changed.map(([key, value]) => `${key}: ${value}`).join(', ')}; save a new card with report_write, then run write on it`
    : null;
};

/**
 * The saved card with its body re-rendered from the data, keeping the frontmatter report_write wrote.
 */
export const relinkCard = (saved: string, data: Row, pageName: string): string => {
  const frontmatter = /^---\n[\s\S]*?\n---\n/.exec(saved)?.[0] ?? '';
  return `${frontmatter}${renderCard(data).split(PAGE_TOKEN).join(pageName)}`;
};

interface MermaidValidator {
  parseMermaid: (source: string) => Promise<{ ok: boolean; error?: string }>;
}

// mermaid resolves only at run time, through NODE_PATH; a non-literal path keeps tsc from following it.
const VALIDATOR = join(import.meta.dir, '..', '..', 'mermaid', 'scripts', 'validate.ts');

const parseDiagrams = async (diagrams: ReportCheck['diagrams']): Promise<string[]> => {
  if (!diagrams.length) {
    return [];
  }
  const { parseMermaid }: MermaidValidator = await import(VALIDATOR);
  const results = await Promise.all(
    diagrams.map(async ({ flow, source }) => {
      const result = await parseMermaid(source);
      return result.ok ? null : `flow "${flow}": diagram doesn't parse: ${result.error}`;
    })
  );
  return results.filter((result): result is string => result !== null);
};

const fail = (message: string): never => {
  console.error(`error: ${message}`);
  process.exit(1);
};

const readData = (path: string): Row => {
  if (!existsSync(path)) {
    return fail(`no data file at ${path}`);
  }
  try {
    const data: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    return isRecord(data) ? data : fail(`${path} must hold a JSON object`);
  } catch (err) {
    return fail(`${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
};

const checked = async (data: unknown): Promise<void> => {
  const { errors, warnings, diagrams } = validate(data);
  const allErrors = [...errors, ...(await parseDiagrams(diagrams))];
  warnings.forEach((item) => console.error(`warning: ${item}`));
  allErrors.forEach((item) => console.error(`error: ${item}`));
  if (allErrors.length) {
    process.exit(1);
  }
};

if (import.meta.main) {
  const [command, first, second] = process.argv.slice(2);
  if (command === 'card' && first) {
    const data = readData(first);
    await checked(data);
    console.log(JSON.stringify(reportArgs(data), null, 2));
  } else if (command === 'write' && first && second) {
    const data = readData(first);
    await checked(data);
    const pageName = `${basename(second, '.md')}.html`;
    const saved = existsSync(second) ? readFileSync(second, 'utf-8') : fail(`no card at ${second}; pass the absolute path report_write returned`);
    if (!saved.includes(PAGE_TOKEN) && !saved.includes(pageName)) {
      fail(`${second} is not this report's card (no page link in it)`);
    }
    const mismatch = cardMismatch(saved, data);
    if (mismatch) {
      fail(`${second}: ${mismatch}`);
    }
    writeFileSync(join(dirname(second), pageName), renderPage(readFileSync(TEMPLATE_PATH, 'utf-8'), data));
    writeFileSync(second, relinkCard(saved, data, pageName));
    console.log(`✓ ${join(dirname(second), pageName)}`);
  } else if (command === 'check' && first) {
    const html = existsSync(first) ? readFileSync(first, 'utf-8') : fail(`no page at ${first}`);
    const { errors, warnings, diagrams } = checkPage(html);
    const allErrors = [...errors, ...(await parseDiagrams(diagrams))];
    warnings.forEach((item) => console.error(`warning: ${item}`));
    allErrors.forEach((item) => console.error(`error: ${item}`));
    console.log(allErrors.length ? `✗ ${allErrors.length} error(s) in ${first}` : `✓ ${first}`);
    process.exit(allErrors.length ? 1 : 0);
  } else {
    console.error('usage: bun pr-report.ts card <data.json> | write <data.json> <report.md> | check <report.html>');
    process.exit(2);
  }
}
