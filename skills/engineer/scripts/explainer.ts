/**
 * Wraps a model-written body in the explainer shell (top bar, contents dropdown, theme, Mermaid).
 *
 *   bun explainer.ts write <body.html> <card.md>   write <card>.html beside the saved card
 *   bun explainer.ts check <body.html | page.html> validate a body before saving, or a written page
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { diagramErrors } from './diagrams';

export const TEMPLATE_PATH = join(import.meta.dir, '..', 'templates', 'explainer.html');

const BODY = /<!-- body:start -->\n?([\s\S]*?)<!-- body:end -->/;
const FORBIDDEN_TAG = /<(script|style|link|iframe|frame|object|embed|form|base|meta)\b/i;
const EVENT_ATTRIBUTE = /<[^>]*[\s/"']on[a-z]+\s*=/i;

/** Browsers read entity-encoded and whitespace-split scheme names (`&#106;avascript:`, `java\tscript:`) as the scheme. */
const schemeText = (html: string): string =>
  html
    .replace(/&#x([0-9a-f]+);?/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_match, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&colon;/gi, ':')
    .replace(/&(tab|newline);/gi, '')
    .replace(/[\s\u0000-\u001f]+/g, '');

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' };
const decode = (html: string): string => html.replace(/&(lt|gt|quot|#39|amp);/g, (entity) => ENTITIES[entity] ?? entity);
const textOf = (html: string): string => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

const WALKTHROUGH = /<div\b[^>]*class=(["'])[^"']*\bwalkthrough\b[^"']*\1[^>]*>([\s\S]*?)<pre\b[^>]*class=(["'])[^"']*\bwt-script\b[^"']*\3[^>]*>([\s\S]*?)<\/pre>/gi;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const parsed = (source: string): unknown => {
  try {
    return JSON.parse(decode(source));
  } catch {
    return undefined;
  }
};

/**
 * A walkthrough's script must parse, and every id a step lights or moves the token to must exist in its svg.
 */
const walkthroughErrors = (body: string): string[] =>
  [...body.matchAll(WALKTHROUGH)].flatMap((match, index) => {
    const label = `walkthrough ${index + 1}`;
    const ids = new Set([...match[2].matchAll(/\bdata-wt=(["'])(.*?)\1/g)].map((found) => found[2]));
    const script = parsed(match[4]);
    if (!isRecord(script) || !Array.isArray(script.scenarios) || !script.scenarios.length) {
      return [`${label}: its wt-script must be JSON with a non-empty "scenarios" list`];
    }
    const steps = script.scenarios.flatMap((scenario, scenarioIndex) =>
      (isRecord(scenario) && Array.isArray(scenario.steps) ? scenario.steps : []).map((step, stepIndex) => ({
        where: `scenario ${scenarioIndex + 1}, step ${stepIndex + 1}`,
        step: isRecord(step) ? step : {},
      })),
    );
    return [
      ...(steps.length ? [] : [`${label}: no scenario has steps`]),
      ...(steps.some(({ step }) => typeof step.at === 'string') && !/\bdata-wt-token\b/.test(match[2])
        ? [`${label}: steps set "at" but its svg has no data-wt-token element`]
        : []),
      ...steps.flatMap(({ where, step }) => [
        ...(typeof step.title === 'string' ? [] : [`${label}, ${where}: a step needs a "title"`]),
        ...[...strings(step.lit), ...(typeof step.at === 'string' ? [step.at] : [])]
          .filter((id) => !ids.has(id))
          .map((id) => `${label}, ${where}: no data-wt="${id}" in its svg`),
      ]),
    ];
  });

const attributeValues = (html: string, name: string): string[] =>
  [...html.matchAll(new RegExp(`\\s${name}=(["'])(.*?)\\1`, 'g'))].map((found) => found[2]);
const words = (values: string[]): string[] => values.flatMap((value) => value.split(/\s+/).filter(Boolean));

/**
 * A mock's controls must lead somewhere: a dialog that exists, a state some element shows for, a tab with a pane.
 */
const mockErrors = (body: string): string[] => {
  const dialogs = new Set([...body.matchAll(/<dialog\b[^>]*\sid=(["'])(.*?)\1/g)].map((found) => found[2]));
  const goes = attributeValues(body, 'data-mock-go').map((state) => state.replace(/^[+-]/, ''));
  const shown = new Set(words([...attributeValues(body, 'data-mock-when'), ...attributeValues(body, 'data-mock-unless')]));
  const reachable = new Set([...goes, ...attributeValues(body, 'data-mock-state')]);
  const panes = new Set(words(attributeValues(body, 'data-mock-pane')));
  return [
    ...new Set([
      ...attributeValues(body, 'data-mock-open')
        .filter((id) => !dialogs.has(id))
        .map((id) => `mock: data-mock-open="${id}" has no <dialog id="${id}">`),
      ...goes
        .filter((state) => !shown.has(state))
        .map((state) => `mock: data-mock-go="${state}" changes nothing, since no data-mock-when or data-mock-unless names that state`),
      ...[...shown]
        .filter((state) => !reachable.has(state))
        .map((state) => `mock: the state "${state}" is shown for, but no data-mock-go or data-mock-state sets it`),
      ...attributeValues(body, 'data-mock-tab')
        .filter((tab) => !panes.has(tab))
        .map((tab) => `mock: data-mock-tab="${tab}" has no data-mock-pane="${tab}"`),
    ]),
  ];
};

/**
 * A reveal card opens the panel with its name, so every card needs its panel and every panel its card.
 */
const revealErrors = (body: string): string[] => {
  const cards = new Set(attributeValues(body, 'data-reveal'));
  const panels = new Set(attributeValues(body, 'data-reveal-panel'));
  return [
    ...[...cards].filter((name) => !panels.has(name)).map((name) => `reveal: data-reveal="${name}" has no data-reveal-panel="${name}"`),
    ...[...panels].filter((name) => !cards.has(name)).map((name) => `reveal: data-reveal-panel="${name}" has no card`),
  ];
};

interface BodyCheck {
  errors: string[];
  title: string;
  diagrams: { label: string; source: string }[];
}

export const checkBody = (body: string): BodyCheck => {
  const h1s = [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  const forbiddenTag = FORBIDDEN_TAG.exec(body)?.[1];
  const sections = [...body.matchAll(/<section\b[^>]*>\s*(?:<!--[\s\S]*?-->\s*)*(<h2\b)?/gi)];
  const diagramBlocks = [...body.matchAll(/<pre\b[^>]*class=(["'])[^"']*\bdiagram\b[^"']*\1[^>]*>([\s\S]*?)<\/pre>/gi)].map((match) => match[2]);
  const codeBlocks = [...body.matchAll(/<pre\b([^>]*)>([\s\S]*?)<\/pre>/gi)]
    .filter((match) => !/class=(["'])[^"']*\bdiagram\b[^"']*\1/i.test(match[1]))
    .map((match) => match[2]);
  const errors = [
    ...[
      forbiddenTag && `a <${forbiddenTag.toLowerCase()}> tag`,
      EVENT_ATTRIBUTE.test(body) && 'an on… event attribute',
      (body.match(/<[^>]*>/g) ?? []).some((tag) => /=["']?javascript:/i.test(schemeText(tag))) && 'a javascript: URL'
    ]
      .filter((what): what is string => typeof what === 'string')
      .map((what) => `the body holds ${what}; the shell owns all script and style`),
    ...(h1s.length === 1 ? [] : [`the body needs exactly one <h1> (the page title), found ${h1s.length}`]),
    ...(sections.length ? [] : ['the body has no <section>; each part of the explainer is a <section> opening with an <h2>']),
    ...sections.flatMap((match, index) => (match[1] ? [] : [`section ${index + 1} doesn't open with an <h2>`])),
    ...diagramBlocks.flatMap((source, index) =>
      /<[a-z/!]/i.test(source) ? [`diagram ${index + 1} holds raw markup; write < as &lt; inside a diagram (e.g. &lt;br/&gt;)`] : []
    ),
    ...codeBlocks.flatMap((source, index) =>
      /<(?!\/?code\b)[a-z/!]/i.test(source) ? [`code block ${index + 1} holds raw markup; write < as &lt; inside a code block (e.g. Promise&lt;void&gt;)`] : []
    ),
    ...walkthroughErrors(body),
    ...mockErrors(body),
    ...revealErrors(body),
  ];
  return { errors, title: h1s[0] ? textOf(h1s[0][1]) : '', diagrams: diagramBlocks.map((source, index) => ({ label: `diagram ${index + 1}`, source: decode(source) })) };
};

export const renderPage = (template: string, body: string, title: string): string =>
  template
    .replace(BODY, () => `<!-- body:start -->\n${body.trim()}\n<!-- body:end -->`)
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${title}</title>`);

export const bodyOf = (page: string): string | null => BODY.exec(page)?.[1] ?? null;

const fail = (message: string): never => {
  console.error(`error: ${message}`);
  process.exit(1);
};

const checked = async (body: string): Promise<BodyCheck> => {
  const result = checkBody(body);
  const errors = [...result.errors, ...(result.errors.length ? [] : await diagramErrors(result.diagrams))];
  errors.forEach((item) => console.error(`error: ${item}`));
  if (errors.length) {
    process.exit(1);
  }
  return result;
};

if (import.meta.main) {
  const [command, first, second] = process.argv.slice(2);
  if (command === 'write' && first && second) {
    const body = existsSync(first) ? readFileSync(first, 'utf-8') : fail(`no body at ${first}`);
    if (!existsSync(second)) {
      fail(`no card at ${second}; pass the absolute path report_write returned`);
    }
    const { title } = await checked(body);
    const page = join(dirname(second), `${basename(second, '.md')}.html`);
    writeFileSync(page, renderPage(readFileSync(TEMPLATE_PATH, 'utf-8'), body, title));
    console.log(page);
  } else if (command === 'check' && first) {
    const html = existsSync(first) ? readFileSync(first, 'utf-8') : fail(`no file at ${first}`);
    await checked(bodyOf(html) ?? html);
    console.log('ok');
  } else {
    console.error('usage: bun explainer.ts write <body.html> <card.md> | check <body.html | page.html>');
    process.exit(1);
  }
}
