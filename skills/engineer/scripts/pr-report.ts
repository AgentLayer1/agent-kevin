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
import { escapeHtml } from '../../../mcp-server/src/status/html-primitives';
import { diagramErrors } from './diagrams';

export const BLOCK_ID = 'pr-report-data';
export const PAGE_TOKEN = '{{pr-report-page}}';
export const TEMPLATE_PATH = join(import.meta.dir, '..', 'templates', 'pr-report.html');

const KINDS = ['review', 'replies'];
const VERDICTS = ['approve', 'approve-with-fixes', 'needs-discussion', 'changes-requested', 'do-not-merge'];
const RISKS = ['S', 'M', 'L', 'XL'];
const CLASSES = ['risk', 'logic', 'mechanical'];
const SEVERITIES = ['blocker', 'fix-before-merge', 'nit', 'question'];
const INTRODUCED = ['yes', 'made-worse', 'pre-existing'];
const LANES = ['correctness', 'invariants', 'security', 'regressions', 'conventions', 'tests', 'hygiene', 'generated-code', 'performance', 'architecture', 'case-against', 'gate'];
const CRITICAL_LANES = ['invariants', 'security'];
const ASKED = ['met', 'not-met', 'untested'];
const CLAIMS = ['matches', 'partly', 'wrong', 'missing'];
const PRIOR_STATUSES = ['fixed', 'changed', 'open', 'moot'];
const THREAD_KINDS = ['person', 'bot'];
const THREAD_STATES = ['open', 'partly', 'fixed', 'answered', 'unanswered', 'wrong', 'outdated'];
const TONES = ['ok', 'warn', 'bad', 'cool'];
const TOPICS = ['tests', 'lint'];
const RESULTS = ['pass', 'fail', 'not-run', 'partial', 'info'];
const WHERE = ['inline', 'conversation', 'review'];
const STATUSES = ['to-post', 'follow-up', 'posted'];
const PATH = /^[^\s:`]+$/;
const LINES = /^([1-9]\d*)(?:-([1-9]\d*))?$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const COMMENT_ID = /^(discussion_r|issuecomment-|pullrequestreview-)\d+$/;
const LOOK_LIMIT = 5;
const SCENARIO_STEPS = [3, 5];
const GLANCE_WORDS = 14;

const KEYS = {
  common: ['kind', 'pr', 'stack', 'summary', 'checks', 'prior', 'draft'],
  review: [
    'verdict', 'risk', 'riskWhy', 'executed', 'sinceReview', 'description', 'lookAt', 'skim', 'decisions', 'asked', 'callTree', 'explanation', 'flows', 'walkTree',
    'behavior', 'holdQuestions', 'architecture', 'caseAgainst', 'findings', 'files', 'conversation', 'verifiedClean', 'summaryComment', 'noticed', 'dropped', 'notChecked'
  ],
  replies: ['sinceLast', 'threads', 'ownFindings', 'commits', 'resolveOnly', 'stillOpen'],
  pr: ['number', 'title', 'author', 'repo', 'head', 'base', 'adds', 'dels'],
  stack: ['number', 'title', 'current'],
  check: ['check', 'result', 'notes'],
  look: ['anchor', 'why'],
  decision: ['decision', 'picks', 'anchor'],
  asked: ['criterion', 'status', 'anchor'],
  flow: ['title', 'diagram', 'steps'],
  step: ['anchor', 'text'],
  textView: ['title', 'sub', 'text'],
  behavior: ['case', 'before', 'after', 'bad', 'diff'],
  description: ['picture', 'claims', 'proposed'],
  claim: ['claim', 'code', 'anchor', 'status'],
  sinceReview: ['prior', 'sub', 'findings', 'commits', 'conversation'],
  priorFinding: ['id', 'title', 'status', 'anchor', 'now'],
  priorCommit: ['sha', 'subject'],
  architecture: ['sub', 'decision', 'components', 'stats', 'today', 'concerns', 'target', 'mapping', 'comparisons', 'debt', 'path'],
  comparison: ['title', 'sub', 'today', 'target'],
  archDiagram: ['title', 'diagram', 'caption'],
  archStat: ['value', 'label', 'tone'],
  concern: ['concern', 'ok', 'state', 'today', 'anchor', 'recommended', 'reuses'],
  debt: ['adds', 'paysDown'],
  pathStep: ['step', 'what'],
  caseAgainst: ['strongest', 'threeMonths', 'cut'],
  finding: [
    'id', 'priorId', 'severity', 'topic', 'title', 'anchor', 'lanes', 'principle', 'introduced', 'raisedBy', 'scenario', 'failure', 'diagram', 'snippet', 'proof', 'evidence', 'comment'
  ],
  proof: ['anchor', 'source', 'fact'],
  raisedBy: ['who', 'url'],
  file: ['path', 'class', 'concern', 'summary', 'adds', 'dels', 'hunks'],
  hunk: ['lines', 'text'],
  conversation: ['who', 'kind', 'url', 'anchor', 'point', 'state', 'finding', 'note', 'reply'],
  noticed: ['anchor', 'text'],
  dropped: ['anchor', 'lanes', 'claim', 'reason'],
  thread: ['id', 'url', 'where', 'anchor', 'reviewer', 'bot', 'outdated', 'pr', 'point', 'quote', 'status', 'reply'],
  ownFinding: ['title', 'anchor', 'detail', 'comment'],
  commit: ['subject', 'body'],
  resolveOnly: ['anchor', 'topic', 'why']
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

interface ReportCheck {
  errors: string[];
  warnings: string[];
  diagrams: { label: string; source: string }[];
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

// A misspelled key would otherwise drop its section from the page without a word.
const keyErrors = (record: Row, allowed: string[], path: string): string[] =>
  Object.keys(record)
    .filter((key) => !allowed.includes(key))
    .map((key) => `${path}${path ? '.' : ''}${key} is not a field${key === 'lane' ? ' (use lanes, a list)' : ''}`);

const rowErrors = (value: unknown, path: string, keys: string[], check: (row: Row, at: string) => string[]): string[] =>
  value === undefined
    ? []
    : !Array.isArray(value)
      ? [`${path} must be a list`]
      : value.flatMap((row, index) => {
          const at = `${path}[${index}]`;
          return isRecord(row) ? [...check(row, at), ...keyErrors(row, keys, at)] : [`${at} must be an object`];
        });

const textListErrors = (value: unknown, path: string): string[] =>
  value === undefined
    ? []
    : !Array.isArray(value)
      ? [`${path} must be a list`]
      : value.flatMap((item, index) => (isText(item) ? [] : [`${path}[${index}] must be non-empty text`]));

const prOf = (data: Row): Row => (isRecord(data.pr) ? data.pr : {});

const optionalTextErrors = (record: Row, keys: string[], path: string): string[] =>
  keys.filter((key) => record[key] !== undefined && !isText(record[key])).map((key) => `${path}${path ? '.' : ''}${key} must be text`);

const countErrors = (record: Row, keys: string[], path: string): string[] =>
  keys.filter((key) => record[key] !== undefined && !(Number.isInteger(record[key]) && Number(record[key]) >= 0)).map((key) => `${path}.${key} must be a whole number`);

const severityCount = (data: Row, severity: string): number => rows(data.findings).filter((finding) => finding.severity === severity).length;

const verdictErrors = (data: Row): string[] => {
  const blockers = severityCount(data, 'blocker');
  const fixes = severityCount(data, 'fix-before-merge');
  const questions = severityCount(data, 'question');
  const nits = severityCount(data, 'nit');
  const rule: Record<string, [boolean, string]> = {
    approve: [blockers + fixes + questions === 0, 'approve leaves no blocker, fix-before-merge or question'],
    'approve-with-fixes': [
      blockers + fixes === 0 && questions + nits > 0,
      'approve-with-fixes leaves no blocker or fix-before-merge, and has a question or nit to act on'
    ],
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
    ...rowErrors(data.stack, 'stack', KEYS.stack, (row, at) => [
      ...(Number.isInteger(row.number) ? [] : [`${at}.number must be an integer`]),
      ...textErrors(row, ['title'], at),
      ...oneLineErrors(row, ['title'], at)
    ]),
    ...rowErrors(data.checks, 'checks', KEYS.check, (row, at) => [...textErrors(row, ['check'], at), ...enumErrors(row.result, RESULTS, `${at}.result`)]),
    ...textListErrors(data.prior, 'prior')
  ];
};

const objectErrors = (value: unknown, path: string, keys: string[], check: (record: Row) => string[], required = false): string[] =>
  value === undefined ? (required ? [`${path} is required`] : []) : isRecord(value) ? [...check(value), ...keyErrors(value, keys, path)] : [`${path} must be an object`];

const viewErrors = (value: unknown, path: string): string[] =>
  objectErrors(value, path, KEYS.textView, (view) => [...textErrors(view, ['text'], path), ...optionalTextErrors(view, ['title', 'sub'], path)]);

const diagramViewErrors = (value: unknown, path: string, required: boolean): string[] =>
  objectErrors(value, path, KEYS.archDiagram, (view) => [...textErrors(view, ['title', 'diagram'], path), ...optionalTextErrors(view, ['caption'], path)], required);

const booleanErrors = (record: Row, keys: string[], path: string): string[] =>
  keys.filter((key) => record[key] !== undefined && typeof record[key] !== 'boolean').map((key) => `${path}.${key} must be true or false`);

const isThreadUrl = (pr: Row, value: unknown, numbers: unknown[] = [pr.number]): boolean =>
  numbers.some((number) => {
    const prefix = `https://github.com/${text(pr.repo)}/pull/${String(number)}#`;
    return isText(value) && value.startsWith(prefix) && COMMENT_ID.test(value.slice(prefix.length));
  });

const mermaidBlocks = (value: unknown): string[] => [...text(value).matchAll(/```mermaid\n([\s\S]*?)```/g)].map((match) => match[1]);

const descriptionErrors = (data: Row): string[] =>
  objectErrors(
    data.description,
    'description',
    KEYS.description,
    (desc) => [
      ...viewErrors(desc.picture, 'description.picture'),
      ...(list(desc.claims).length ? [] : ['description.claims needs every claim the body makes, plus what it leaves out']),
      ...rowErrors(desc.claims, 'description.claims', KEYS.claim, (row, at) => [
        ...textErrors(row, ['claim', 'code'], at),
        ...enumErrors(row.status, CLAIMS, `${at}.status`),
        ...optionalAnchor(row.anchor, `${at}.anchor`)
      ]),
      ...optionalTextErrors(desc, ['proposed'], 'description'),
      ...(rows(desc.claims).some((claim) => claim.status !== 'matches') && !isText(desc.proposed)
        ? ['description.proposed must give the author an accurate description to paste when any claim does not match']
        : [])
    ],
    true
  );

const sinceReviewErrors = (data: Row): string[] =>
  objectErrors(data.sinceReview, 'sinceReview', KEYS.sinceReview, (since) => [
    ...textErrors(since, ['prior'], 'sinceReview'),
    ...optionalTextErrors(since, ['sub'], 'sinceReview'),
    ...rowErrors(since.findings, 'sinceReview.findings', KEYS.priorFinding, (row, at) => [
      ...(Number.isInteger(row.id) ? [] : [`${at}.id must be the integer id the last review gave it`]),
      ...textErrors(row, ['title', 'now'], at),
      ...oneLineErrors(row, ['title'], at),
      ...enumErrors(row.status, PRIOR_STATUSES, `${at}.status`),
      ...optionalAnchor(row.anchor, `${at}.anchor`)
    ]),
    ...rowErrors(since.commits, 'sinceReview.commits', KEYS.priorCommit, (row, at) => [...textErrors(row, ['sha', 'subject'], at), ...oneLineErrors(row, ['subject'], at)]),
    ...textListErrors(since.conversation, 'sinceReview.conversation')
  ]);

const architectureErrors = (data: Row): string[] =>
  objectErrors(data.architecture, 'architecture', KEYS.architecture, (arch) => [
    ...optionalTextErrors(arch, ['sub', 'decision'], 'architecture'),
    ...diagramViewErrors(arch.components, 'architecture.components', false),
    ...diagramViewErrors(arch.today, 'architecture.today', true),
    ...diagramViewErrors(arch.target, 'architecture.target', true),
    ...viewErrors(arch.mapping, 'architecture.mapping'),
    ...rowErrors(arch.comparisons, 'architecture.comparisons', KEYS.comparison, (row, at) => [
      ...textErrors(row, ['title'], at),
      ...optionalTextErrors(row, ['sub'], at),
      ...viewErrors(row.today, `${at}.today`),
      ...viewErrors(row.target, `${at}.target`),
      ...(row.today === undefined || row.target === undefined ? [`${at} needs both today and target`] : [])
    ]),
    ...rowErrors(arch.stats, 'architecture.stats', KEYS.archStat, (row, at) => [
      ...(isText(row.value) || Number.isFinite(row.value) ? [] : [`${at}.value must be a number or short text`]),
      ...textErrors(row, ['label'], at),
      ...optionalEnum(row.tone, TONES, `${at}.tone`)
    ]),
    ...(list(arch.concerns).length ? [] : ['architecture.concerns needs a row per concern the feature has']),
    ...rowErrors(arch.concerns, 'architecture.concerns', KEYS.concern, (row, at) => [
      ...textErrors(row, ['concern', 'state', 'today', 'recommended', 'reuses'], at),
      ...booleanErrors(row, ['ok'], at),
      ...optionalAnchor(row.anchor, `${at}.anchor`)
    ]),
    ...objectErrors(
      arch.debt,
      'architecture.debt',
      KEYS.debt,
      (debt) => [...textListErrors(debt.adds, 'architecture.debt.adds'), ...textListErrors(debt.paysDown, 'architecture.debt.paysDown')],
      true
    ),
    ...(list(arch.path).length ? [] : ['architecture.path needs the steps from today to the recommended shape']),
    ...rowErrors(arch.path, 'architecture.path', KEYS.pathStep, (row, at) => textErrors(row, ['step', 'what'], at))
  ]);

const reviewErrors = (data: Row): string[] => {
  const pr = prOf(data);
  const findings = rows(data.findings);
  const findingIds = findings.map((finding) => finding.id);
  const threadUrls = rows(data.conversation).map((thread) => thread.url).filter(isText);
  const priorIds = rows(isRecord(data.sinceReview) ? data.sinceReview.findings : undefined).map((row) => row.id);
  const filePaths = rows(data.files).map((file) => text(file.path));
  const inFiles = (anchor: unknown, at: string): string[] => (isText(anchor) && !filePaths.includes(anchorPath(anchor)) ? [`${at}.anchor names a file missing from files`] : []);
  const stackNumbers = [pr.number, ...rows(data.stack).map((layer) => layer.number)];
  const urlErrors = (value: unknown, at: string): string[] =>
    value === undefined || isThreadUrl(pr, value, stackNumbers)
      ? []
      : [`${at} must be a comment on this PR or a PR in its stack, https://github.com/${text(pr.repo)}/pull/<n>#<discussion_r…, issuecomment-… or pullrequestreview-…>, got ${JSON.stringify(value)}`];
  return [
    ...enumErrors(data.verdict, VERDICTS, 'verdict'),
    ...verdictErrors(data),
    ...enumErrors(data.risk, RISKS, 'risk'),
    ...optionalTextErrors(data, ['riskWhy', 'executed', 'skim', 'explanation', 'summaryComment'], ''),
    ...sinceReviewErrors(data),
    ...descriptionErrors(data),
    ...(list(data.lookAt).length ? [] : ['lookAt needs at least one hunk to read']),
    ...rowErrors(data.lookAt, 'lookAt', KEYS.look, (row, at) => [...anchorErrors(row.anchor, `${at}.anchor`), ...inFiles(row.anchor, at), ...textErrors(row, ['why'], at)]),
    ...rowErrors(data.decisions, 'decisions', KEYS.decision, (row, at) => [...textErrors(row, ['decision', 'picks'], at), ...anchorErrors(row.anchor, `${at}.anchor`), ...inFiles(row.anchor, at)]),
    ...rowErrors(data.asked, 'asked', KEYS.asked, (row, at) => [
      ...textErrors(row, ['criterion'], at),
      ...enumErrors(row.status, ASKED, `${at}.status`),
      ...optionalAnchor(row.anchor, `${at}.anchor`)
    ]),
    ...(data.callTree !== undefined || isText(data.explanation) || list(data.flows).length ? [] : ['How it works needs a callTree, an explanation or at least one flow']),
    ...viewErrors(data.callTree, 'callTree'),
    ...viewErrors(data.walkTree, 'walkTree'),
    ...rowErrors(data.flows, 'flows', KEYS.flow, (row, at) => [
      ...textErrors(row, ['title', 'diagram'], at),
      ...rowErrors(row.steps, `${at}.steps`, KEYS.step, (step, stepAt) => [...textErrors(step, ['text'], stepAt), ...optionalAnchor(step.anchor, `${stepAt}.anchor`)])
    ]),
    ...rowErrors(data.behavior, 'behavior', KEYS.behavior, (row, at) => [
      ...textErrors(row, ['case', 'after'], at),
      ...optionalTextErrors(row, ['before', 'diff'], at),
      ...booleanErrors(row, ['bad'], at)
    ]),
    ...textListErrors(data.holdQuestions, 'holdQuestions'),
    ...architectureErrors(data),
    ...(data.caseAgainst === undefined
      ? []
      : isRecord(data.caseAgainst)
        ? [...textErrors(data.caseAgainst, KEYS.caseAgainst, 'caseAgainst'), ...keyErrors(data.caseAgainst, KEYS.caseAgainst, 'caseAgainst')]
        : ['caseAgainst must be an object']),
    ...rowErrors(data.findings, 'findings', KEYS.finding, (row, at) => [
      ...(Number.isInteger(row.id) ? [] : [`${at}.id must be an integer`]),
      ...enumErrors(row.severity, SEVERITIES, `${at}.severity`),
      ...textErrors(row, ['title', 'comment'], at),
      ...oneLineErrors(row, ['title'], at),
      ...optionalTextErrors(row, ['failure', 'evidence', 'snippet', 'diagram'], at),
      ...anchorErrors(row.anchor, `${at}.anchor`, row.severity === 'nit'),
      ...inFiles(row.anchor, at),
      ...(row.lanes === undefined ? [`${at}.lanes must list every source that raised it`] : lanesErrors(row.lanes, `${at}.lanes`)),
      ...optionalEnum(row.introduced, INTRODUCED, `${at}.introduced`),
      ...optionalEnum(row.topic, TOPICS, `${at}.topic`),
      ...(row.severity === 'blocker' || row.severity === 'fix-before-merge'
        ? [
            ...(list(row.scenario).length || isText(row.failure) ? [] : [`${at} needs a scenario (or failure) saying what goes wrong`]),
            ...(list(row.proof).length || isText(row.evidence) ? [] : [`${at} needs proof (or evidence) saying what was read or run`])
          ]
        : []),
      ...(row.scenario === undefined
        ? []
        : [
            ...textListErrors(row.scenario, `${at}.scenario`),
            ...(list(row.scenario).length >= SCENARIO_STEPS[0] && list(row.scenario).length <= SCENARIO_STEPS[1]
              ? []
              : [`${at}.scenario must be ${SCENARIO_STEPS[0]} to ${SCENARIO_STEPS[1]} steps, the last one the wrong outcome`])
          ]),
      ...rowErrors(row.proof, `${at}.proof`, KEYS.proof, (proof, proofAt) => [
        ...textErrors(proof, ['fact'], proofAt),
        ...(isText(proof.anchor) === isText(proof.source) ? [`${proofAt} needs exactly one of anchor or source`] : []),
        ...optionalAnchor(proof.anchor, `${proofAt}.anchor`)
      ]),
      ...objectErrors(row.raisedBy, `${at}.raisedBy`, KEYS.raisedBy, (raised) => [
        ...textErrors(raised, ['who', 'url'], `${at}.raisedBy`),
        ...(isText(raised.url) && !threadUrls.includes(raised.url) ? [`${at}.raisedBy.url must be a thread in conversation`] : [])
      ]),
      ...(row.priorId === undefined || (Number.isInteger(row.priorId) && priorIds.includes(row.priorId)) ? [] : [`${at}.priorId must be an id in sinceReview.findings`])
    ]),
    ...(new Set(findingIds).size === findingIds.length ? [] : ['findings ids must be unique']),
    ...(list(data.files).length ? [] : ['files needs every file on the coverage checklist']),
    ...rowErrors(data.files, 'files', KEYS.file, (row, at) => [
      ...textErrors(row, ['path', 'concern', 'summary'], at),
      ...(isText(row.path) && !PATH.test(row.path) ? [`${at}.path must have no spaces, colons or backticks`] : []),
      ...enumErrors(row.class, CLASSES, `${at}.class`),
      ...countErrors(row, ['adds', 'dels'], at),
      ...rowErrors(row.hunks, `${at}.hunks`, KEYS.hunk, (hunk, hunkAt) => [
        ...textErrors(hunk, ['lines', 'text'], hunkAt),
        ...(isText(hunk.lines) && !linesOk(hunk.lines) ? [`${hunkAt}.lines must be "line" or "start-end" with start ≤ end, got ${JSON.stringify(hunk.lines)}`] : [])
      ])
    ]),
    ...rowErrors(data.conversation, 'conversation', KEYS.conversation, (row, at) => [
      ...textErrors(row, ['who', 'point'], at),
      ...oneLineErrors(row, ['who', 'point'], at),
      ...enumErrors(row.kind, THREAD_KINDS, `${at}.kind`),
      ...enumErrors(row.state, THREAD_STATES, `${at}.state`),
      ...optionalAnchor(row.anchor, `${at}.anchor`),
      ...urlErrors(row.url, `${at}.url`),
      ...optionalTextErrors(row, ['note', 'reply'], at),
      ...(row.finding === undefined || findingIds.includes(row.finding) ? [] : [`${at}.finding points at no finding id`]),
      ...(row.kind === 'bot' && ['open', 'partly'].includes(text(row.state)) && row.finding === undefined
        ? [`${at}.finding must name the finding or question a bot point that still holds became`]
        : []),
      ...(row.state === 'wrong' && !isText(row.note) ? [`${at}.note must say why the point does not hold`] : []),
      ...(row.state === 'wrong' && !isText(row.reply) ? [`${at}.reply must give the operator a reply to paste on the thread`] : [])
    ]),
    ...textListErrors(data.verifiedClean, 'verifiedClean'),
    ...rowErrors(data.noticed, 'noticed', KEYS.noticed, (row, at) => [...anchorErrors(row.anchor, `${at}.anchor`), ...textErrors(row, ['text'], at)]),
    ...rowErrors(data.dropped, 'dropped', KEYS.dropped, (row, at) => [
      ...anchorErrors(row.anchor, `${at}.anchor`),
      ...textErrors(row, ['claim', 'reason'], at),
      ...lanesErrors(row.lanes, `${at}.lanes`)
    ]),
    ...textListErrors(data.notChecked, 'notChecked')
  ];
};

const repliesErrors = (data: Row): string[] => {
  const pr = prOf(data);
  return [
    ...rowErrors(data.threads, 'threads', KEYS.thread, (row, at) => {
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
        ...(row.status === 'posted' || isText(row.reply) ? [] : [`${at}.reply must be non-empty text unless the thread is posted`])
      ];
    }),
    ...rowErrors(data.ownFindings, 'ownFindings', KEYS.ownFinding, (row, at) => [
      ...textErrors(row, ['title', 'detail'], at),
      ...oneLineErrors(row, ['title'], at),
      ...anchorErrors(row.anchor, `${at}.anchor`)
    ]),
    ...rowErrors(data.commits, 'commits', KEYS.commit, (row, at) => [...textErrors(row, ['subject'], at), ...oneLineErrors(row, ['subject'], at)]),
    ...rowErrors(data.resolveOnly, 'resolveOnly', KEYS.resolveOnly, (row, at) => [...textErrors(row, ['topic', 'why'], at), ...optionalAnchor(row.anchor, `${at}.anchor`)]),
    ...textListErrors(data.stillOpen, 'stillOpen'),
    ...textListErrors(data.sinceLast, 'sinceLast')
  ];
};

const words = (value: unknown): number => text(value).split(/\s+/).filter(Boolean).length;

const glance = (value: unknown, path: string, limit: number): string[] =>
  words(value) > limit ? [`${path} has ${words(value)} words; ${limit} at most keeps it readable at a glance`] : [];

const glanceWarnings = (data: Row): string[] => [
  ...rows(data.findings).flatMap((finding, index) => [
    ...list(finding.scenario).flatMap((step, stepIndex) => glance(step, `findings[${index}].scenario[${stepIndex}]`, GLANCE_WORDS)),
    ...rows(finding.proof).flatMap((proof, proofIndex) => glance(proof.fact, `findings[${index}].proof[${proofIndex}].fact`, GLANCE_WORDS))
  ]),
  ...rows(data.behavior).flatMap((row, index) => [...glance(row.before, `behavior[${index}].before`, GLANCE_WORDS), ...glance(row.after, `behavior[${index}].after`, GLANCE_WORDS)])
];

const diagramsOf = (data: Row): ReportCheck['diagrams'] => {
  const arch = isRecord(data.architecture) ? data.architecture : {};
  const description = isRecord(data.description) ? data.description : {};
  return [
    ...rows(data.flows).map((flow) => ({ label: `flow "${text(flow.title)}"`, source: flow.diagram })),
    ...rows(data.findings).map((finding) => ({ label: `finding ${String(finding.id)}`, source: finding.diagram })),
    ...['components', 'today', 'target'].map((key) => ({ label: `architecture.${key}`, source: isRecord(arch[key]) ? arch[key].diagram : undefined })),
    ...mermaidBlocks(description.proposed).map((source, index) => ({ label: `description.proposed diagram ${index + 1}`, source }))
  ]
    .filter((diagram) => isText(diagram.source))
    .map((diagram) => ({ label: diagram.label, source: text(diagram.source) }));
};

/** True when the finding's point is already on the PR and the thread still stands, so the comment only adds to it. */
const isReplied = (finding: Row, data: Row): boolean => {
  const url = isRecord(finding.raisedBy) ? finding.raisedBy.url : undefined;
  const thread = rows(data.conversation).find((row) => row.url === url);
  return url !== undefined && !['partly', 'wrong'].includes(text(thread?.state));
};

/**
 * Where a finding sits on the page: signal first; a point already raised (thread still standing) and test or lint findings
 * lower; then nits; questions after, the already-raised and test ones last. A blocker never moves. The template sorts the same way.
 */
export const tierOf = (finding: Row, data: Row): number => {
  if (finding.severity === 'question') {
    return isReplied(finding, data) || finding.topic !== undefined ? 5 : 4;
  }
  if (finding.severity === 'blocker') {
    return 0;
  }
  if (finding.severity === 'nit') {
    return 3;
  }
  return isReplied(finding, data) ? 1 : finding.topic !== undefined ? 2 : 0;
};

const pageOrderIds = (data: Row): unknown[] =>
  [...rows(data.findings)].sort((a, b) => tierOf(a, data) - tierOf(b, data) || Number(a.id) - Number(b.id)).map((finding) => finding.id);

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
      ...(pageOrderIds(data).every((id, index) => id === index + 1)
        ? []
        : ['findings ids should run 1, 2, 3… in page order: blockers and the rest of the signal, then already-raised, tests and lint, nits, then questions']),
      ...glanceWarnings(data),
      ...rows(data.conversation)
        .filter((thread) => thread.finding !== undefined && !rows(data.findings).some((finding) => finding.id === thread.finding && isRecord(finding.raisedBy)))
        .map((thread) => `finding ${String(thread.finding)} answers @${text(thread.who)}'s thread but has no raisedBy, so its paste starts a second comment on the same point`)
    ],
    diagrams: diagramsOf(data)
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
      .sort((a, b) => tierOf(a, data) - tierOf(b, data) || Number(a.id) - Number(b.id))
      .map((finding) => {
        const tag = finding.severity === 'blocker' ? '' : isReplied(finding, data) ? ' · replied' : finding.topic !== undefined ? ` · ${text(finding.topic)}` : '';
        return `- ${SEVERITY_ICON[text(finding.severity)]} #${String(finding.id)} ${md(finding.title)} · ${code(finding.anchor)}${tag}`;
      });
  const since = isRecord(data.sinceReview) ? data.sinceReview : null;
  const priorRows = rows(since?.findings);
  const priorCount = (status: string) => priorRows.filter((row) => row.status === status).length;
  const claims = rows(isRecord(data.description) ? data.description.claims : undefined);
  const claimCount = (status: string) => claims.filter((claim) => claim.status === status).length;
  return [
    `**Verdict** ${VERDICT_LABEL[text(data.verdict)] ?? md(data.verdict)} · **Risk** ${md(data.risk)} · **Page** [open the review](${PAGE_TOKEN})`,
    ...(since
      ? [
          '',
          `**Since last review** (${md(since.prior)}): ${priorCount('fixed')} fixed · ${priorCount('changed')} changed · ${priorCount('open')} still open · ${findings.filter((finding) => finding.priorId === undefined).length} new`
        ]
      : []),
    ...(claims.length
      ? ['', `**PR description** ${claimCount('matches')} match · ${claimCount('partly')} partly · ${claimCount('wrong')} wrong · ${claimCount('missing')} missing from the body`]
      : []),
    ...section('Findings', bySeverity(['blocker', 'fix-before-merge', 'nit'])),
    ...section('Questions for the author', bySeverity(['question'])),
    ...section(
      'Last review, at this head',
      priorRows.map((row) => `- #${String(row.id)} ${text(row.status)}: ${md(row.title)}${isText(row.anchor) ? ` · ${code(row.anchor)}` : ''}`)
    ),
    ...section(
      'Review conversation',
      rows(data.conversation).map(
        (thread) =>
          `- ${line([text(thread.state), `@${md(thread.who)}`, code(thread.anchor), thread.finding === undefined ? undefined : `#${String(thread.finding)}`])}: ${md(thread.point)}`
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
interface ReportArgs {
  body: string;
  summary: string;
  status: string;
  extra: Row;
}

export const reportArgs = (data: Row): ReportArgs => {
  const pr = prOf(data);
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
      ...(data.kind === 'review' ? { verdict: data.verdict, blockers: severityCount(data, 'blocker') } : {})
    }
  };
};

/**
 * The template with its sample data block swapped for this report's data and its title set.
 */
export const renderPage = (template: string, data: Row): string => {
  const pr = prOf(data);
  const title = `PR #${String(pr.number)}${data.kind === 'replies' ? ' replies' : ''} — ${text(pr.title)}`;
  return template
    .replace(new RegExp(`<script\\b[^>]*\\bid="${BLOCK_ID}"[^>]*>[\\s\\S]*?</script>`), () => jsonBlock(BLOCK_ID, data, 'data'))
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(title)}</title>`);
};

/**
 * Why a saved card can't take this data, or null when it can: another PR or kind, or a status the data has since changed.
 */
export const cardMismatch = (saved: string, data: Row): string | null => {
  const front = /^---\n([\s\S]*?)\n---\n/.exec(saved)?.[1] ?? '';
  const field = (key: string): string => (new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(front)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
  const { status, extra } = reportArgs(data);
  if (field('pr') !== String(extra.pr) || field('mode') !== String(extra.mode)) {
    return `the card is PR #${field('pr') || '?'} (${field('mode') || '?'}), but the data is PR #${String(extra.pr)} (${String(extra.mode)})`;
  }
  const changed = [
    ['status', status],
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

const parseDiagrams = (diagrams: ReportCheck['diagrams']): Promise<string[]> => diagramErrors(diagrams);

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

/** Prints a check's warnings and errors, diagrams parsed, and returns how many errors it found. */
const reported = async ({ errors, warnings, diagrams }: ReportCheck): Promise<number> => {
  const allErrors = [...errors, ...(await parseDiagrams(diagrams))];
  warnings.forEach((item) => console.error(`warning: ${item}`));
  allErrors.forEach((item) => console.error(`error: ${item}`));
  return allErrors.length;
};

const checked = async (data: Row): Promise<void> => {
  if (await reported(validate(data))) {
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
    const mismatch = cardMismatch(saved, data);
    if (mismatch) {
      fail(`${second}: ${mismatch}`);
    }
    writeFileSync(join(dirname(second), pageName), renderPage(readFileSync(TEMPLATE_PATH, 'utf-8'), data));
    writeFileSync(second, relinkCard(saved, data, pageName));
    console.log(`✓ ${join(dirname(second), pageName)}`);
  } else if (command === 'check' && first) {
    const html = existsSync(first) ? readFileSync(first, 'utf-8') : fail(`no page at ${first}`);
    const count = await reported(checkPage(html));
    console.log(count ? `✗ ${count} error(s) in ${first}` : `✓ ${first}`);
    process.exit(count ? 1 : 0);
  } else {
    console.error('usage: bun pr-report.ts card <data.json> | write <data.json> <report.md> | check <report.html>');
    process.exit(2);
  }
}
