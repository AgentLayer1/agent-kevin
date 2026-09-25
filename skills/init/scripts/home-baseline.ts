#!/usr/bin/env bun
/**
 * The part of init's Step 7 baseline that no template merge reaches: the home's `.gitignore`
 * (reconciled against `templates/.gitignore`), the `permissions.allow` / `permissions.ask`
 * entries and `plansDirectory`. `--write` writes the `.gitignore` (without it, a dry run);
 * settings are only reported, for the caller to merge.
 *
 * Usage: home-baseline.ts --home <dir> [--write]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveEnv } from '../../../mcp-server/src/shared/naming';
import { expandTilde } from '../../../mcp-server/src/shared/paths';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};
const homeFlag = flag('home');
if (!homeFlag) {
  process.stderr.write('usage: home-baseline.ts --home <dir> [--write]\n');
  process.exit(2);
}
const home = resolve(homeFlag);
const pluginRoot = resolve(import.meta.dir, '..', '..', '..');

const reconcileGitignore = (current: string, template: string) => {
  const templateRules = template
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

  // Two git rules: the last matching pattern wins, so a negation must sit below the rule it
  // carves out of; and git can't re-include a file whose parent directory is excluded, so a
  // bare `dir/` must become the template's `dir/*`.
  const contentsRules = new Map(
    templateRules
      .filter((rule) => rule.endsWith('/*'))
      .flatMap((rule) => {
        const dir = rule.slice(0, -2);
        return [dir, `${dir}/`, `/${dir}`, `/${dir}/`].map((bare) => [bare, rule] as const);
      })
  );
  const eol = current.includes('\r\n') ? '\r\n' : '\n';
  const original = current.split(/\r?\n/);
  const lines = original.map((line) => contentsRules.get(line.trim()) ?? line);
  const rewritten = original.map((line) => line.trim()).filter((line) => contentsRules.has(line));

  const homeRules = lines.map((line) => line.trim());
  const added = templateRules.reduce<string[]>((acc, rule, index) => {
    const present = [...homeRules, ...acc];
    const carvedFrom = rule.startsWith('!')
      ? templateRules.slice(0, index).findLast((above) => !above.startsWith('!'))
      : undefined;
    const effective = carvedFrom ? present.lastIndexOf(rule) > present.lastIndexOf(carvedFrom) : present.includes(rule);
    return effective ? acc : [...acc, rule];
  }, []);

  const body = lines.join(eol);
  const separated = body === '' ? '' : `${body.endsWith(eol) ? body : body + eol}${eol}`;
  const text = added.length === 0 ? body : `${separated}# agent-kevin${eol}${added.join(eol)}${eol}`;
  return { text, rewritten, added };
};

const gitignorePath = join(home, '.gitignore');
const template = readFileSync(join(pluginRoot, 'templates', '.gitignore'), 'utf-8');
const created = !existsSync(gitignorePath);
const before = created ? '' : readFileSync(gitignorePath, 'utf-8');
const gitignore = created ? { text: template, rewritten: [], added: [] } : reconcileGitignore(before, template);
if (gitignore.text !== before && args.includes('--write')) {
  writeFileSync(gitignorePath, gitignore.text);
}

const skill = readFileSync(join(pluginRoot, 'skills', 'init', 'SKILL.md'), 'utf-8');
const jsonBlockAfter = <T>(anchor: string): T => {
  const at = skill.indexOf(anchor);
  const fence = skill.indexOf('```json\n', at);
  const close = skill.indexOf('\n```', fence + 8);
  if (at === -1 || fence === -1 || close === -1) {
    throw new Error(`init SKILL.md no longer carries a JSON block after "${anchor}"`);
  }
  return JSON.parse(skill.slice(fence + 8, close)) as T;
};
const baselineAllow = jsonBlockAfter<{ permissions: { allow: string[] } }>(
  'Concrete approach: `Read` the existing file'
).permissions.allow;
const baselineAsk = jsonBlockAfter<string[]>('Baseline `permissions.ask`');

interface HomeSettings {
  plansDirectory?: string;
  permissions?: Partial<Record<'allow' | 'ask' | 'deny', string[]>>;
}
const settingsPath = join(home, '.claude', 'settings.json');
const settings: HomeSettings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf-8')) : {};
const listed = (...lists: ('allow' | 'ask' | 'deny')[]) =>
  new Set(lists.flatMap((list) => settings.permissions?.[list] ?? []));
const decidedForAllow = listed('allow', 'ask', 'deny');
const decidedForAsk = listed('ask', 'deny');

const configuredReports = resolveEnv('AGENT_REPORTS');
const reportsRoot = configuredReports ? resolve(expandTilde(configuredReports)) : join(home, 'reports');
const defaultPlans = reportsRoot === join(home, 'reports') ? './reports/plans' : join(reportsRoot, 'plans');

process.stdout.write(
  JSON.stringify(
    {
      gitignore: { created, rewritten: gitignore.rewritten, added: gitignore.added },
      settings: {
        allowMissing: baselineAllow.filter((entry) => !decidedForAllow.has(entry)),
        askMissing: baselineAsk.filter((entry) => !decidedForAsk.has(entry)),
        plansDirectory: settings.plansDirectory === undefined ? defaultPlans : null
      }
    },
    null,
    2
  ) + '\n'
);
