#!/usr/bin/env bun
/**
 * The part of init's Step 7 baseline that no template merge reaches: the home's `.gitignore`
 * (reconciled against `templates/.gitignore`), the `permissions.allow` / `permissions.ask`
 * entries, the `permissions.deny` list, the sandbox, `plansDirectory` and the Haiku-tier model, and
 * any retired skill's grant an older release left behind. The home's two settings files are read as
 * the one view Claude Code acts on, so an entry kept in `settings.local.json` counts as present.
 * The core deny list and the sandbox block are gap-filled against the user settings, the same
 * test init applies. It also records this plugin in the data dir's `version.json`, which is how a
 * home tells this agent's data dir from a sibling's. `--write` writes the `.gitignore` and that
 * record (without it, a dry run); settings are only reported, for the caller to merge.
 *
 * Usage: home-baseline.ts --home <dir> [--claude-dir <dir>] [--write]
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { reconcileHomeGitignore } from '../../../mcp-server/src/home/gitignore';
import {
  LEGACY_RUNTIME_DIR,
  RUNTIME_DIR,
  ownDataDir,
  pluginName,
  recordedPlugin,
  resolveEnv
} from '../../../mcp-server/src/shared/naming';
import { migrateGrant, migrateGrants } from '../../../mcp-server/src/shared/retired-skills';
import { expandTilde, isInside } from '../../../mcp-server/src/shared/paths';
import { readMergedSettings } from '../../../mcp-server/src/home/settings-scope';

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
const PLUGIN = pluginName();
const write = args.includes('--write');

const gitignore = reconcileHomeGitignore(home, join(pluginRoot, 'templates', '.gitignore'), write);

type Identity =
  | { state: 'current' | 'missing' | 'stamped' | 'no-baseline' | 'unreadable' }
  | { state: 'mismatch'; recorded: string };

// A home recorded for another plugin is never rewritten: that would hand its data dir to this agent.
const stampPlugin = (dataDir: string): Identity => {
  const file = join(dataDir, 'version.json');
  if (!existsSync(file)) {
    return { state: 'no-baseline' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return { state: 'unreadable' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { state: 'unreadable' };
  }
  const recorded = recordedPlugin(dataDir);
  if (recorded === PLUGIN) {
    return { state: 'current' };
  }
  if (recorded !== undefined) {
    return { state: 'mismatch', recorded };
  }
  if (!write) {
    return { state: 'missing' };
  }
  const stamped = Object.fromEntries([
    ['plugin', PLUGIN],
    ...Object.entries(parsed).filter(([key]) => key !== 'plugin')
  ]);
  writeFileSync(`${file}.tmp`, `${JSON.stringify(stamped, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
  return { state: 'stamped' };
};
// Only init and upgrade run this, in a home they checked, so an unrecorded `.state` is this agent's
// with its record dropped (upgrade's baseline rewrite can lose it), and the stamp restores it. A data
// dir recorded for another plugin is still the one looked at, so it reports as a mismatch.
const identity = stampPlugin(
  ownDataDir(home) ??
    [RUNTIME_DIR, LEGACY_RUNTIME_DIR].map((name) => join(home, name)).find((dir) => existsSync(dir)) ??
    join(home, RUNTIME_DIR)
);

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
const baselineSandbox = jsonBlockAfter<Record<string, unknown>>('Baseline `sandbox` block to write');
const baselineUvSandbox = jsonBlockAfter<{
  filesystem: { allowWrite: string[] };
  network: { allowedDomains: string[] };
}>('Baseline uv sandbox grants');
const haikuModel = /`env\.ANTHROPIC_DEFAULT_HAIKU_MODEL` = `"([^"]+)"`/.exec(skill)?.[1];
if (!haikuModel) {
  throw new Error('init SKILL.md no longer names the ANTHROPIC_DEFAULT_HAIKU_MODEL baseline');
}
const retiredHaikuModels = ['claude-sonnet-4-6'];
const LISTS = ['allow', 'ask', 'deny'] as const;

interface HomeSettings {
  env?: Record<string, string>;
  plansDirectory?: string;
  permissions?: Partial<Record<'allow' | 'ask' | 'deny', string[]>>;
  sandbox?: { enabled?: boolean; filesystem?: { allowWrite?: string[] }; network?: { allowedDomains?: string[] } };
}
const readSettings = (path: string): HomeSettings => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : {});
const homeSettings = readMergedSettings(home);
const settings = homeSettings.merged as HomeSettings;
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
// Claude Code ignores a plans folder outside the project, so a relocated reports root outside the home gets none.
const plansRelative = relative(home, join(reportsRoot, 'plans')).split(sep).join('/');
const defaultPlans = isInside(reportsRoot, home) ? `./${plansRelative}` : null;

process.stdout.write(
  JSON.stringify(
    {
      gitignore,
      identity,
      settings: {
        allowMissing: baselineAllow.filter((entry) => !decidedForAllow.has(entry)),
        askMissing: baselineAsk.filter((entry) => !decidedForAsk.has(entry)),
        denyMissing: baselineDeny.filter((entry) => !decidedForDeny.has(entry)),
        sandboxBlock: process.platform === 'win32' || sandboxDecided ? null : baselineSandbox,
        sandboxMissing: {
          allowWrite: missingFrom(settings.sandbox?.filesystem?.allowWrite, baselineUvSandbox.filesystem.allowWrite),
          allowedDomains: missingFrom(
            settings.sandbox?.network?.allowedDomains,
            baselineUvSandbox.network.allowedDomains
          )
        },
        retiredGrants: LISTS.flatMap((list) =>
          ((homeSettings.shared as HomeSettings).permissions?.[list] ?? []).flatMap((entry) => {
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
