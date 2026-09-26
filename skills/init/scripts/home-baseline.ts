#!/usr/bin/env bun
/**
 * The part of init's Step 7 baseline that no template merge reaches: the home's `.gitignore`
 * (reconciled against `templates/.gitignore`), the `permissions.allow` / `permissions.ask`
 * entries and `plansDirectory`. `--write` writes the `.gitignore` (without it, a dry run);
 * settings are only reported, for the caller to merge.
 *
 * Usage: home-baseline.ts --home <dir> [--write]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { reconcileHomeGitignore } from '../../../mcp-server/src/home/gitignore';
import { resolveEnv, runtimeDirName } from '../../../mcp-server/src/shared/naming';
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

const gitignore = reconcileHomeGitignore(home, join(pluginRoot, 'templates', '.gitignore'), args.includes('--write'), runtimeDirName());

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
      gitignore,
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
