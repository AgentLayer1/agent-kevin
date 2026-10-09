#!/usr/bin/env bun
/**
 * Check a PR explainer page after writing it: `bun explainer-check.ts <explainer.html>`.
 * Exits 1 with the errors when the data block is missing, won't parse, isn't script-safe, breaks the
 * shape the template renders, or holds a diagram Mermaid can't parse. Run with NODE_PATH pointed at
 * the plugin's mcp-server/node_modules so the diagram parser resolves.
 */
import { readFileSync } from 'node:fs';
import { isRecord, isScriptSafe, readJsonBlock } from '../../../mcp-server/src/shared/json-block';

export const BLOCK_ID = 'pr-explainer-data';

const VERDICTS = ['approve', 'approve-with-fixes', 'needs-discussion', 'changes-requested', 'do-not-merge'];
const RISKS = ['S', 'M', 'L', 'XL'];
const CLASSES = ['risk', 'logic', 'mechanical'];
const SEVERITIES = ['blocker', 'fix-before-merge', 'nit', 'question', 'decision'];
const ANCHOR = /^[^\s:]+:\d+(-\d+)?$/;
const LOOK_LIMIT = 5;

export interface ExplainerCheck {
  errors: string[];
  warnings: string[];
  diagrams: { flow: string; source: string }[];
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const textErrors = (record: Record<string, unknown>, keys: string[], path: string): string[] =>
  keys.filter((key) => !isText(record[key])).map((key) => `${path}.${key} must be non-empty text`);

const anchorErrors = (value: unknown, path: string): string[] =>
  isText(value) && ANCHOR.test(value) ? [] : [`${path} must be "path:line" or "path:start-end", got ${JSON.stringify(value)}`];

const enumErrors = (value: unknown, allowed: string[], path: string): string[] =>
  typeof value === 'string' && allowed.includes(value) ? [] : [`${path} must be one of ${allowed.join(' | ')}, got ${JSON.stringify(value)}`];

const rowErrors = (rows: unknown, path: string, check: (row: Record<string, unknown>, at: string) => string[]): string[] =>
  list(rows).flatMap((row, index) => (isRecord(row) ? check(row, `${path}[${index}]`) : [`${path}[${index}] must be an object`]));

const dataErrors = (data: Record<string, unknown>): string[] => {
  const pr = isRecord(data.pr) ? data.pr : null;
  const flows = list(data.flows);
  const files = list(data.files);
  return [
    ...(pr ? textErrors(pr, ['title', 'author', 'head', 'base'], 'pr') : ['pr must be an object']),
    ...(pr && !Number.isInteger(pr.number) ? ['pr.number must be an integer'] : []),
    ...enumErrors(data.verdict, VERDICTS, 'verdict'),
    ...enumErrors(data.risk, RISKS, 'risk'),
    ...(isText(data.summary) ? [] : ['summary must be non-empty text']),
    ...(list(data.lookAt).length ? [] : ['lookAt needs at least one hunk to read']),
    ...rowErrors(data.lookAt, 'lookAt', (row, at) => [...anchorErrors(row.anchor, `${at}.anchor`), ...textErrors(row, ['why'], at)]),
    ...rowErrors(data.decisions, 'decisions', (row, at) => [
      ...textErrors(row, ['decision', 'picks'], at),
      ...anchorErrors(row.anchor, `${at}.anchor`)
    ]),
    ...(flows.length ? [] : ['flows needs at least one flow']),
    ...rowErrors(data.flows, 'flows', (row, at) => [
      ...textErrors(row, ['title', 'diagram'], at),
      ...rowErrors(row.steps, `${at}.steps`, (step, stepAt) => [
        ...textErrors(step, ['text'], stepAt),
        ...(step.anchor === undefined ? [] : anchorErrors(step.anchor, `${stepAt}.anchor`))
      ])
    ]),
    ...rowErrors(data.behavior, 'behavior', (row, at) => textErrors(row, ['case', 'before', 'after'], at)),
    ...(data.caseAgainst === undefined
      ? []
      : isRecord(data.caseAgainst)
        ? textErrors(data.caseAgainst, ['strongest', 'threeMonths', 'cut'], 'caseAgainst')
        : ['caseAgainst must be an object']),
    ...(files.length ? [] : ['files needs every file on the coverage checklist']),
    ...rowErrors(data.files, 'files', (row, at) => [
      ...textErrors(row, ['path', 'concern', 'summary'], at),
      ...enumErrors(row.class, CLASSES, `${at}.class`),
      ...rowErrors(row.hunks, `${at}.hunks`, (hunk, hunkAt) => textErrors(hunk, ['lines', 'text'], hunkAt))
    ]),
    ...rowErrors(data.findings, 'findings', (row, at) => [
      ...enumErrors(row.severity, SEVERITIES, `${at}.severity`),
      ...textErrors(row, ['title'], at),
      ...anchorErrors(row.anchor, `${at}.anchor`)
    ]),
    ...rowErrors(data.stack, 'stack', (row, at) => [
      ...(Number.isInteger(row.number) ? [] : [`${at}.number must be an integer`]),
      ...textErrors(row, ['title'], at)
    ])
  ];
};

/**
 * The shape and safety checks; diagrams are returned for the caller to parse.
 */
export const checkExplainer = (html: string): ExplainerCheck => {
  const read = readJsonBlock(html, BLOCK_ID);
  if (!read) {
    return { errors: [`no <script id="${BLOCK_ID}"> block`], warnings: [], diagrams: [] };
  }
  if (read.kind === 'invalid') {
    return { errors: [`${BLOCK_ID} is not valid JSON: ${read.error}`], warnings: [], diagrams: [] };
  }
  if (!isRecord(read.data)) {
    return { errors: [`${BLOCK_ID} must hold an object`], warnings: [], diagrams: [] };
  }
  const data = read.data;
  const looks = list(data.lookAt).length;
  return {
    errors: [...(isScriptSafe(read.raw) ? [] : ['the data block holds an unescaped "</" or "<!--"; write "<\\/" instead']), ...dataErrors(data)],
    warnings: looks > LOOK_LIMIT ? [`lookAt has ${looks} hunks; ${LOOK_LIMIT} at most keeps it a reading guide`] : [],
    diagrams: list(data.flows)
      .filter(isRecord)
      .filter((flow) => isText(flow.diagram))
      .map((flow) => ({ flow: String(flow.title), source: String(flow.diagram) }))
  };
};

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: bun explainer-check.ts <explainer.html>');
    process.exit(2);
  }
  const { errors, warnings, diagrams } = checkExplainer(readFileSync(path, 'utf-8'));
  const { parseMermaid } = await import('../../mermaid/scripts/validate');
  const diagramErrors = (
    await Promise.all(
      diagrams.map(async ({ flow, source }) => {
        const result = await parseMermaid(source);
        return result.ok ? null : `flow "${flow}": diagram doesn't parse: ${result.error}`;
      })
    )
  ).filter((line): line is string => line !== null);
  const allErrors = [...errors, ...diagramErrors];
  [...allErrors.map((line) => `error: ${line}`), ...warnings.map((line) => `warning: ${line}`)].forEach((line) => console.log(line));
  console.log(allErrors.length ? `✗ ${allErrors.length} error(s) in ${path}` : `✓ ${path} (${diagrams.length} diagram(s), ${warnings.length} warning(s))`);
  process.exit(allErrors.length ? 1 : 0);
}
