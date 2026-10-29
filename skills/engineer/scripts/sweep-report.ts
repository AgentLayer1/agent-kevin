#!/usr/bin/env bun
/**
 * Render a GitHub sweep from one data file.
 *   bun sweep-report.ts card <data.json>              validate, print the report_write arguments (card body included) as JSON
 *   bun sweep-report.ts write <data.json> <report.md>  write <report>.html beside the saved card and re-render the card
 *   bun sweep-report.ts check <report.html>            re-validate a page
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { isRecord, isScriptSafe, jsonBlock, readJsonBlock } from '../../../mcp-server/src/shared/json-block';
import { escapeHtml } from '../../../mcp-server/src/status/html-primitives';

export const BLOCK_ID = 'sweep-report-data';
export const PAGE_TOKEN = '{{sweep-report-page}}';
export const TEMPLATE_PATH = join(import.meta.dir, '..', 'templates', 'sweep-report.html');

const KINDS = ['person', 'bot'];
const WHERE = ['inline', 'conversation', 'review', 'issue'];
const CONFIDENCE = ['confirmed', 'strong', 'unverified'];
const REVIEW = ['owed', 're-review', 'pending', 'none'];
const SIZES = ['trivial', 'small', 'medium', 'large'];
const PROMISE_STATUS = ['open', 'done', 'superseded', 'wrong'];
const FIRST_MOVES_LIMIT = 10;
const URL = /^https:\/\/github\.com\//;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const KEYS = {
  top: [
    'generatedAt',
    'login',
    'repo',
    'since',
    'supersedes',
    'summary',
    'standup',
    'firstMoves',
    'needsCode',
    'conflicts',
    'promises',
    'issues',
    'prs',
    'quiet',
    'notChecked'
  ],
  firstMove: ['ref', 'what', 'why'],
  needsCode: ['pr', 'fix', 'size'],
  conflict: ['pr', 'files', 'note'],
  promise: ['ref', 'url', 'to', 'at', 'promise', 'status', 'evidence', 'confidence'],
  issue: ['number', 'title', 'url', 'status', 'prs', 'owed'],
  pr: ['number', 'title', 'url', 'author', 'mine', 'draft', 'mergeable', 'reviewDecision', 'review', 'next', 'owed'],
  owed: [
    'id',
    'url',
    'who',
    'kind',
    'at',
    'new',
    'where',
    'point',
    'quote',
    'reply',
    'action',
    'needsFirst',
    'confidence',
    'note'
  ],
  quiet: ['ref', 'note']
};

type Row = Record<string, unknown>;

export interface SweepCheck {
  errors: string[];
  warnings: string[];
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const rows = (value: unknown): Row[] => list(value).filter(isRecord);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const isNumber = (value: unknown): value is number => Number.isInteger(value) && Number(value) > 0;

const keyErrors = (record: Row, allowed: string[], path: string): string[] =>
  Object.keys(record)
    .filter((key) => !allowed.includes(key))
    .map((key) => `${path}: unknown key "${key}"`);

const textErrors = (record: Row, keys: string[], path: string): string[] =>
  keys.filter((key) => !isText(record[key])).map((key) => `${path}.${key} must be non-empty text`);

const enumError = (value: unknown, allowed: string[], path: string): string[] =>
  allowed.includes(text(value)) ? [] : [`${path} must be one of ${allowed.join(', ')}`];

const optionalText = (record: Row, keys: string[], path: string): string[] =>
  keys
    .filter((key) => record[key] !== undefined && !isText(record[key]))
    .map((key) => `${path}.${key} must be non-empty text when present`);

const arrayErrors = (data: Row, key: string): string[] =>
  data[key] === undefined || (Array.isArray(data[key]) && list(data[key]).every(isRecord))
    ? []
    : [`${key} must be a list of objects`];

const owedErrors = (owed: Row, path: string): string[] => [
  ...keyErrors(owed, KEYS.owed, path),
  ...textErrors(owed, ['id', 'who', 'at', 'point'], path),
  ...(URL.test(text(owed.url)) ? [] : [`${path}.url must be a https://github.com/ link`]),
  ...enumError(owed.kind, KINDS, `${path}.kind`),
  ...enumError(owed.where, WHERE, `${path}.where`),
  ...enumError(owed.confidence, CONFIDENCE, `${path}.confidence`),
  ...(typeof owed.new === 'boolean' ? [] : [`${path}.new must be true or false`]),
  ...(isText(owed.reply) || isText(owed.action) ? [] : [`${path} needs a reply or an action`]),
  ...optionalText(owed, ['quote', 'reply', 'action', 'needsFirst', 'note'], path)
];

const itemErrors = (record: Row, path: string, keys: string[], required: string[]): string[] => [
  ...keyErrors(record, keys, path),
  ...(isNumber(record.number) ? [] : [`${path}.number must be a positive integer`]),
  ...textErrors(record, required, path),
  ...(URL.test(text(record.url)) ? [] : [`${path}.url must be a https://github.com/ link`]),
  ...(Array.isArray(record.owed) ? [] : [`${path}.owed must be a list (empty when nothing is owed)`]),
  ...rows(record.owed).flatMap((owed, index) => owedErrors(owed, `${path}.owed[${index}]`))
];

const prErrors = (pr: Row, path: string): string[] => [
  ...itemErrors(pr, path, KEYS.pr, ['title', 'author', 'mergeable']),
  ...['mine', 'draft']
    .filter((key) => typeof pr[key] !== 'boolean')
    .map((key) => `${path}.${key} must be true or false`),
  ...enumError(pr.review, REVIEW, `${path}.review`),
  ...optionalText(pr, ['reviewDecision', 'next'], path)
];

const issueErrors = (issue: Row, path: string): string[] => [
  ...itemErrors(issue, path, KEYS.issue, ['title', 'status']),
  ...(list(issue.prs).every(isNumber) ? [] : [`${path}.prs must be a list of PR numbers`])
];

const duplicateIds = (data: Row): string[] => {
  const ids = [...rows(data.issues), ...rows(data.prs)].flatMap((item) => rows(item.owed).map((owed) => text(owed.id)));
  return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].map(
    (id) => `owed id "${id}" appears twice; each comment belongs to one item`
  );
};

export const validate = (data: Row): SweepCheck => {
  const errors = [
    ...keyErrors(data, KEYS.top, 'data'),
    ...textErrors(data, ['login', 'summary', 'standup'], 'data'),
    ...(REPO.test(text(data.repo)) ? [] : ['data.repo must be owner/name']),
    ...(ISO.test(text(data.generatedAt)) ? [] : ['data.generatedAt must be an ISO timestamp']),
    ...(data.since === null || ISO.test(text(data.since))
      ? []
      : ['data.since must be an ISO timestamp, or null on a first sweep']),
    ...(data.supersedes === null || isText(data.supersedes)
      ? []
      : ["data.supersedes must be the prior sweep's relPath, or null"]),
    ...['firstMoves', 'needsCode', 'conflicts', 'promises', 'issues', 'prs', 'quiet'].flatMap((key) =>
      arrayErrors(data, key)
    ),
    ...['issues', 'prs'].filter((key) => !Array.isArray(data[key])).map((key) => `data.${key} must be a list`),
    ...rows(data.firstMoves).flatMap((move, index) => [
      ...keyErrors(move, KEYS.firstMove, `firstMoves[${index}]`),
      ...textErrors(move, ['ref', 'what'], `firstMoves[${index}]`)
    ]),
    ...(list(data.firstMoves).length > FIRST_MOVES_LIMIT
      ? [`firstMoves holds at most ${FIRST_MOVES_LIMIT}; the rest live in their sections`]
      : []),
    ...rows(data.needsCode).flatMap((row, index) => [
      ...keyErrors(row, KEYS.needsCode, `needsCode[${index}]`),
      ...(isNumber(row.pr) ? [] : [`needsCode[${index}].pr must be a PR number`]),
      ...textErrors(row, ['fix'], `needsCode[${index}]`),
      ...enumError(row.size, SIZES, `needsCode[${index}].size`)
    ]),
    ...rows(data.conflicts).flatMap((row, index) => [
      ...keyErrors(row, KEYS.conflict, `conflicts[${index}]`),
      ...(rows(data.prs).some((pr) => pr.number === row.pr) ? [] : [`conflicts[${index}].pr must be a PR in prs`]),
      ...optionalText(row, ['files', 'note'], `conflicts[${index}]`)
    ]),
    ...rows(data.promises).flatMap((row, index) => [
      ...keyErrors(row, KEYS.promise, `promises[${index}]`),
      ...textErrors(row, ['ref', 'promise', 'evidence'], `promises[${index}]`),
      ...(URL.test(text(row.url)) ? [] : [`promises[${index}].url must be a https://github.com/ link`]),
      ...(row.at === undefined || ISO.test(text(row.at)) ? [] : [`promises[${index}].at must be an ISO timestamp`]),
      ...enumError(row.status, PROMISE_STATUS, `promises[${index}].status`),
      ...enumError(row.confidence, CONFIDENCE, `promises[${index}].confidence`),
      ...optionalText(row, ['to'], `promises[${index}]`)
    ]),
    ...rows(data.issues).flatMap((issue, index) => issueErrors(issue, `issues[${index}]`)),
    ...rows(data.prs).flatMap((pr, index) => prErrors(pr, `prs[${index}]`)),
    ...rows(data.quiet).flatMap((row, index) => [
      ...keyErrors(row, KEYS.quiet, `quiet[${index}]`),
      ...textErrors(row, ['ref', 'note'], `quiet[${index}]`)
    ]),
    ...(data.notChecked === undefined || list(data.notChecked).every(isText)
      ? []
      : ['notChecked must be a list of text']),
    ...duplicateIds(data)
  ];
  const prNumbers = new Set(rows(data.prs).map((pr) => pr.number));
  const warnings = [
    ...rows(data.issues).flatMap((issue) =>
      list(issue.prs)
        .filter((number) => !prNumbers.has(number))
        .map(
          (number) =>
            `issue #${String(issue.number)} links PR #${String(number)}, which isn't in prs; it shows as a plain reference`
        )
    ),
    ...rows(data.prs)
      .filter((pr) => pr.review !== 'none' && pr.mine === true)
      .map((pr) => `PR #${String(pr.number)} is the operator's own, so review "${String(pr.review)}" is ignored`)
  ];
  return { errors, warnings };
};

export const countsOf = (
  data: Row
): { owed: number; newOwed: number; reviews: number; pending: number; conflicts: number; needsCode: number } => {
  const owed = [...rows(data.issues), ...rows(data.prs)].flatMap((item) => rows(item.owed));
  const theirs = rows(data.prs).filter((pr) => pr.mine !== true);
  return {
    owed: owed.length,
    newOwed: owed.filter((item) => item.new === true).length,
    reviews: theirs.filter((pr) => pr.review === 'owed' || pr.review === 're-review').length,
    pending: theirs.filter((pr) => pr.review === 'pending').length,
    conflicts: list(data.conflicts).length,
    needsCode: list(data.needsCode).length
  };
};

// `%%` opens an Obsidian comment, which would hide the rest of the card.
const escapeMd = (value: string): string => value.replace(/([[\]<>`\\])/g, '\\$1').replace(/%%/g, '%\\%');

const md = (value: unknown): string => escapeMd(text(value).replace(/\s*\n\s*/g, ' '));

const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

const renderCard = (data: Row): string => {
  const counts = countsOf(data);
  const moves = rows(data.firstMoves).map((move, index) => `${index + 1}. **${md(move.ref)}** ${md(move.what)}`);
  return [
    `**Waiting on you:** ${plural(counts.owed, 'reply', 'replies')} owed (${counts.newOwed} new) · ${plural(counts.reviews, 'review')} · ${counts.pending} pending · ${plural(counts.conflicts, 'conflict')} · ${counts.needsCode} need code first`,
    '',
    md(data.summary),
    '',
    `**Standup:** ${md(data.standup)}`,
    ...(moves.length ? ['', '## First moves', '', ...moves] : []),
    '',
    `[Open the sweep page](${PAGE_TOKEN})`,
    ''
  ].join('\n');
};

export const reportArgs = (data: Row): { body: string; summary: string; status: string; extra: Row } => {
  const counts = countsOf(data);
  return {
    body: renderCard(data),
    summary: text(data.summary).replace(/\s+/g, ' ').trim(),
    status: counts.owed + counts.reviews + counts.pending > 0 ? 'findings' : 'clean',
    extra: {
      repo: text(data.repo),
      generatedAt: text(data.generatedAt),
      supersedes: isText(data.supersedes) ? data.supersedes : null,
      owed: counts.owed,
      reviews: counts.reviews,
      conflicts: counts.conflicts
    }
  };
};

export const renderPage = (template: string, data: Row): string =>
  template
    .replace(new RegExp(`<script\\b[^>]*\\bid="${BLOCK_ID}"[^>]*>[\\s\\S]*?</script>`), () =>
      jsonBlock(BLOCK_ID, data, 'data')
    )
    .replace(
      /<title>[\s\S]*?<\/title>/,
      () => `<title>${escapeHtml(`GitHub sweep — ${text(data.repo)} — ${text(data.generatedAt).slice(0, 10)}`)}</title>`
    );

export const checkPage = (html: string): SweepCheck => {
  const read = readJsonBlock(html, BLOCK_ID);
  if (!read) {
    return { errors: [`no <script id="${BLOCK_ID}"> block`], warnings: [] };
  }
  if (read.kind === 'invalid') {
    return { errors: [`${BLOCK_ID} is not valid JSON: ${read.error}`], warnings: [] };
  }
  const result = isRecord(read.data)
    ? validate(read.data)
    : { errors: [`${BLOCK_ID} must hold an object`], warnings: [] };
  return isScriptSafe(read.raw)
    ? result
    : { ...result, errors: ['the data block holds an unescaped "</" or "<!--"', ...result.errors] };
};

/**
 * Why a saved card can't take this data, or null when it can: another repo, another run, or a status the data has since changed.
 */
export const cardMismatch = (saved: string, data: Row): string | null => {
  const front = /^---\n([\s\S]*?)\n---\n/.exec(saved)?.[1] ?? '';
  const field = (key: string): string =>
    (new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(front)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
  const { status, extra } = reportArgs(data);
  const changed = [
    ['repo', String(extra.repo)],
    ['generatedAt', String(extra.generatedAt)],
    ['status', status]
  ].filter(([key, value]) => field(key) !== value);
  return changed.length
    ? `the card was saved with ${changed.map(([key]) => `${key}: ${field(key) || '?'}`).join(', ')}, but the data gives ${changed.map(([key, value]) => `${key}: ${value}`).join(', ')}; save a new card with report_write, then run write on it`
    : null;
};

const relinkCard = (saved: string, data: Row, pageName: string): string => {
  const frontmatter = /^---\n[\s\S]*?\n---\n/.exec(saved)?.[0] ?? '';
  return `${frontmatter}${renderCard(data).split(PAGE_TOKEN).join(pageName)}`;
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

const reported = ({ errors, warnings }: SweepCheck): number => {
  warnings.forEach((item) => console.error(`warning: ${item}`));
  errors.forEach((item) => console.error(`error: ${item}`));
  return errors.length;
};

if (import.meta.main) {
  const [command, first, second] = process.argv.slice(2);
  if (command === 'card' && first) {
    const data = readData(first);
    if (reported(validate(data))) {
      process.exit(1);
    }
    console.log(JSON.stringify(reportArgs(data), null, 2));
  } else if (command === 'write' && first && second) {
    const data = readData(first);
    if (reported(validate(data))) {
      process.exit(1);
    }
    const pageName = `${basename(second, '.md')}.html`;
    const saved = existsSync(second)
      ? readFileSync(second, 'utf-8')
      : fail(`no card at ${second}; pass the absolute path report_write returned`);
    const mismatch = cardMismatch(saved, data);
    if (mismatch) {
      fail(`${second}: ${mismatch}`);
    }
    writeFileSync(join(dirname(second), pageName), renderPage(readFileSync(TEMPLATE_PATH, 'utf-8'), data));
    writeFileSync(second, relinkCard(saved, data, pageName));
    console.log(`✓ ${join(dirname(second), pageName)}`);
  } else if (command === 'check' && first) {
    const html = existsSync(first) ? readFileSync(first, 'utf-8') : fail(`no page at ${first}`);
    const count = reported(checkPage(html));
    console.log(count ? `✗ ${count} error(s) in ${first}` : `✓ ${first}`);
    process.exit(count ? 1 : 0);
  } else {
    console.error('usage: bun sweep-report.ts card <data.json> | write <data.json> <report.md> | check <report.html>');
    process.exit(2);
  }
}
