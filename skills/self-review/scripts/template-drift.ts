#!/usr/bin/env bun
/**
 * Lines an agent home carries that the plugin's templates lack, per `##` section of SOUL, IDENTITY,
 * AGENTS, and each rule file the templates ship, plus rule-shaped lines living in USER.md and the
 * preferences facet. Self-review reads it every cycle so a generic rule a home accumulated gets
 * proposed upstream instead of passing as "present and working". With `--base` (the templates as
 * they were at the home's baseline), each home-only line also says whether it is the old template's
 * own wording, which is what lets upgrade tell a stale line from the operator's. Read-only.
 *
 * Usage: template-drift.ts --home <dir> [--plugin <root>] [--base <templates-dir>]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface Section {
  heading: string;
  lines: string[];
}

interface HomeOnlyLine {
  section: string;
  line: string;
  inBase?: boolean;
}

interface FileDrift {
  file: string;
  homeOnlySections: string[];
  homeOnlyLines: HomeOnlyLine[];
}

const args = process.argv.slice(2);
const flag = (name: string): string | undefined =>
  args.indexOf(name) === -1 ? undefined : args[args.indexOf(name) + 1];

const homeArg = flag('--home');
if (!homeArg) {
  console.error('usage: template-drift.ts --home <dir> [--plugin <root>] [--base <templates-dir>]');
  process.exit(2);
}
const home = resolve(homeArg);
const plugin = resolve(flag('--plugin') ?? join(import.meta.dir, '..', '..', '..'));
const templates = join(plugin, 'templates');
const baseArg = flag('--base');
const base = baseArg === undefined ? undefined : resolve(baseArg);

const PREAMBLE = '(preamble)';
const RULE_WORDS = /\b(always|never|must|don't|do not|avoid|only|prefer|instead of|before you)\b/i;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

const normalize = (line: string): string => line.trim().replace(/\s+/g, ' ');

/** A template line becomes a pattern: its `{{PLACEHOLDER}}` tokens match whatever the home resolved them to. */
const toPattern = (line: string): RegExp =>
  new RegExp(
    `^${normalize(line)
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\{\\\{[A-Z_]+\\\}\\\}/g, '.+?')}$`
  );

const sectionsOf = (text: string): Section[] =>
  text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .reduce<{ sections: Section[]; inFence: boolean }>(
      ({ sections, inFence }, line) => {
        if (FENCE.test(line)) {
          return { sections: appendLine(sections, line), inFence: !inFence };
        }
        if (!inFence && /^## /.test(line)) {
          return { sections: [...sections, { heading: normalize(line.slice(3)), lines: [] }], inFence };
        }
        return { sections: appendLine(sections, line), inFence };
      },
      { sections: [{ heading: PREAMBLE, lines: [] }], inFence: false }
    ).sections;

const appendLine = (sections: Section[], line: string): Section[] => {
  const last = sections.at(-1);
  if (last === undefined) {
    return [{ heading: PREAMBLE, lines: [line] }];
  }
  return [...sections.slice(0, -1), { heading: last.heading, lines: [...last.lines, line] }];
};

const isContent = (line: string): boolean => {
  const trimmed = normalize(line);
  return trimmed.length > 0 && !/^(-{3,}|#{1,6} .*|`{3,}.*|~{3,}.*)$/.test(trimmed);
};

const linePatternsOf = (path: string): RegExp[] =>
  sectionsOf(readFileSync(path, 'utf-8')).flatMap((section) => section.lines.filter(isContent).map(toPattern));

const known = (line: string, patterns: RegExp[]) => patterns.some((pattern) => pattern.test(normalize(line)));

const driftOf = (file: string, homePath: string, templatePath: string, basePath?: string): FileDrift => {
  const homeSections = sectionsOf(readFileSync(homePath, 'utf-8'));
  const headingPatterns = sectionsOf(readFileSync(templatePath, 'utf-8')).map((section) => toPattern(section.heading));
  const linePatterns = linePatternsOf(templatePath);
  const basePatterns = basePath !== undefined && existsSync(basePath) ? linePatternsOf(basePath) : undefined;
  return {
    file,
    homeOnlySections: homeSections
      .map((section) => section.heading)
      .filter((heading) => heading !== PREAMBLE && !known(heading, headingPatterns)),
    homeOnlyLines: homeSections.flatMap((section) =>
      section.lines
        .filter((line) => isContent(line) && !known(line, linePatterns))
        .map((line) => ({
          section: section.heading,
          line: normalize(line),
          ...(basePatterns === undefined ? {} : { inBase: known(line, basePatterns) })
        }))
    )
  };
};

const rulesDir = join(templates, 'rules');
const pairs = [
  ...['SOUL.md', 'IDENTITY.md', 'AGENTS.md'].map((name) => ({
    file: name,
    homePath: join(home, name),
    templatePath: join(templates, name),
    basePath: base && join(base, name)
  })),
  {
    file: '.claude/CLAUDE.md',
    homePath: join(home, '.claude', 'CLAUDE.md'),
    templatePath: join(templates, 'CLAUDE.md'),
    basePath: base && join(base, 'CLAUDE.md')
  },
  ...(existsSync(rulesDir) ? readdirSync(rulesDir) : [])
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({
      file: `.claude/rules/${name}`,
      homePath: join(home, '.claude', 'rules', name),
      templatePath: join(rulesDir, name),
      basePath: base && join(base, 'rules', name)
    }))
].filter(({ homePath, templatePath }) => existsSync(homePath) && existsSync(templatePath));

const ruleLike = ['USER.md', join('knowledge', 'user', 'preferences.md')]
  .filter((rel) => existsSync(join(home, rel)))
  .flatMap((rel) =>
    readFileSync(join(home, rel), 'utf-8')
      .split('\n')
      .filter((line) => /^\s*[-*] /.test(line) && RULE_WORDS.test(line))
      .map((line) => ({ file: rel, line: normalize(line) }))
  );

console.log(
  JSON.stringify(
    {
      home,
      plugin,
      base: base ?? null,
      files: pairs.map(({ file, homePath, templatePath, basePath }) => driftOf(file, homePath, templatePath, basePath)),
      ruleLike
    },
    null,
    2
  )
);
