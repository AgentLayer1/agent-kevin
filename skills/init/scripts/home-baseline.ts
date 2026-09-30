#!/usr/bin/env bun
/**
 * The part of init's Step 7 baseline that no template merge reaches: the home's `.gitignore`
 * (reconciled against `templates/.gitignore`), the `permissions.allow` / `permissions.ask`
 * entries, the `permissions.deny` list, the sandbox, `plansDirectory` and the Haiku-tier model, and
 * any retired skill's grant an older release left behind.
 * The core deny list and the sandbox block are gap-filled against the user settings, the same
 * test init applies. `--write` writes the `.gitignore` (without it, a dry run); settings are only
 * reported, for the caller to merge.
 *
 * Usage: home-baseline.ts --home <dir> [--claude-dir <dir>] [--write]
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { reconcileHomeGitignore } from '../../../mcp-server/src/home/gitignore';
import { resolveEnv, runtimeDirName } from '../../../mcp-server/src/shared/naming';
import { migrateGrant, migrateGrants } from '../../../mcp-server/src/shared/retired-skills';
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
const claudeDir = resolve(flag('claude-dir') ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'));
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
const baselinePythonDeny = jsonBlockAfter<string[]>('Baseline Python guard `permissions.deny`');
const baselineCoreDeny = jsonBlockAfter<string[]>('Cross-platform core (always written)');
const osTailAnchors: Partial<Record<NodeJS.Platform, string>> = {
  darwin: '`macos`:',
  linux: '`linux` / `wsl`:',
  win32: '`windows` (Git Bash'
};
const osTailAnchor = osTailAnchors[process.platform];
const baselineOsDeny = osTailAnchor ? jsonBlockAfter<string[]>(osTailAnchor) : [];
const rawSandbox = jsonBlockAfter<{ filesystem: Record<string, unknown> } & Record<string, unknown>>(
  'Baseline `sandbox` block to write'
);
// The block's allowWrite is a placeholder for the code root, which only init's interview knows.
const baselineSandbox = {
  ...rawSandbox,
  filesystem: Object.fromEntries(Object.entries(rawSandbox.filesystem).filter(([key]) => key !== 'allowWrite'))
};
const baselineUvSandbox = jsonBlockAfter<{
  filesystem: { allowWrite: string[] };
  network: { allowedDomains: string[] };
}>('Baseline uv sandbox grants');
const haikuModel = /`env\.ANTHROPIC_DEFAULT_HAIKU_MODEL` = `"([^"]+)"`/.exec(skill)?.[1];
if (!haikuModel) {
  throw new Error('init SKILL.md no longer names the ANTHROPIC_DEFAULT_HAIKU_MODEL baseline');
}
const retiredHaikuModels = ['claude-sonnet-4-6'];
const PLUGIN = 'agent-kevin';
const LISTS = ['allow', 'ask', 'deny'] as const;

interface HomeSettings {
  env?: Record<string, string>;
  plansDirectory?: string;
  permissions?: Partial<Record<'allow' | 'ask' | 'deny', string[]>>;
  sandbox?: { enabled?: boolean; filesystem?: { allowWrite?: string[] }; network?: { allowedDomains?: string[] } };
}
const readSettings = (path: string): HomeSettings =>
  existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : {};
const settings = readSettings(join(home, '.claude', 'settings.json'));
const userSettings = readSettings(join(claudeDir, 'settings.json'));
const userCuratesDeny = (userSettings.permissions?.deny ?? []).length > 0;
const baselineDeny = userCuratesDeny
  ? baselinePythonDeny
  : [...baselineCoreDeny, ...baselineOsDeny, ...baselinePythonDeny];
const sandboxDecided = settings.sandbox?.enabled !== undefined || userSettings.sandbox?.enabled === true;
// A retired skill's grant counts as its successor's, so an old `ask` placement keeps deciding it.
const listed = (...lists: ('allow' | 'ask' | 'deny')[]) =>
  new Set(lists.flatMap((list) => migrateGrants(settings.permissions?.[list] ?? [], PLUGIN)));
const decidedForAllow = listed('allow', 'ask', 'deny');
const decidedForAsk = listed('ask', 'deny');
const decidedForDeny = listed('allow', 'ask', 'deny');
const missingFrom = (present: string[] | undefined, wanted: string[]) =>
  wanted.filter((entry) => !(present ?? []).includes(entry));
const currentHaiku = settings.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL;

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
        denyMissing: baselineDeny.filter((entry) => !decidedForDeny.has(entry)),
        sandboxBlock: process.platform === 'win32' || sandboxDecided ? null : baselineSandbox,
        sandboxMissing: {
          allowWrite: missingFrom(settings.sandbox?.filesystem?.allowWrite, baselineUvSandbox.filesystem.allowWrite),
          allowedDomains: missingFrom(settings.sandbox?.network?.allowedDomains, baselineUvSandbox.network.allowedDomains)
        },
        retiredGrants: LISTS.flatMap((list) =>
          (settings.permissions?.[list] ?? []).flatMap((entry) => {
            const replacement = migrateGrant(entry, PLUGIN);
            return replacement ? [{ list, entry, replacement }] : [];
          })
        ),
        plansDirectory: settings.plansDirectory === undefined ? defaultPlans : null,
        haikuModel: !currentHaiku || retiredHaikuModels.includes(currentHaiku) ? haikuModel : null
      }
    },
    null,
    2
  ) + '\n'
);
