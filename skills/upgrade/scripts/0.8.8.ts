#!/usr/bin/env bun
/**
 * Upgrade migration for v0.8.8: the focus skill is now attention, so a home's focus files and tool
 * grants follow it.
 *
 * `projects/<slug>/focus.html` becomes `attention.html` (an existing `attention.html` wins and the old
 * page goes, since the dashboard re-renders it), the queue cache in `<data-dir>/focus/` moves to
 * `<data-dir>/attention/` (or is dropped when the new one exists: it refills on the next pull), and
 * both settings files' `allow`, `ask` and `deny` lists go through `migrateGrants`, so a `focus_write`
 * or `Skill(<plugin>:focus)` rule becomes its successor in the same list. The baseline reconcile reads
 * only `settings.json`, and runs after this script, so an operator's placement decides the successor.
 *
 * Both settings files are read and planned first, so one that is not JSON fails the run before anything
 * in the home changes.
 *
 * Run by `/agent-kevin:upgrade` via `run_upgrade` (outside the Bash sandbox). Idempotent.
 * Contract: prints a single-line JSON report as its LAST stdout line; exits non-zero on failure.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { FOLDERS, PLUGIN_NAME } from '../../../mcp-server/src/config';
import { migrateGrants } from '../../../mcp-server/src/shared/retired-skills';

const VERSION = '0.8.8';

const HOME = resolve(process.env.AGENT_HOME?.trim() || process.cwd());
const QUEUES = { from: join(dirname(FOLDERS.ATTENTION_QUEUES), 'focus'), to: FOLDERS.ATTENTION_QUEUES };
const LISTS = ['allow', 'ask', 'deny'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

interface PageMoves {
  moved: string[];
  removed: string[];
}

const movePages = (): PageMoves => {
  const projects = existsSync(FOLDERS.PROJECTS)
    ? readdirSync(FOLDERS.PROJECTS, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    : [];
  return projects
    .map((entry) => join(FOLDERS.PROJECTS, entry.name, 'focus.html'))
    .filter((page) => existsSync(page))
    .reduce<PageMoves>(
      (result, page) => {
        const next = join(dirname(page), 'attention.html');
        const outcome = existsSync(next) ? 'removed' : 'moved';
        if (outcome === 'removed') {
          rmSync(page);
        } else {
          renameSync(page, next);
        }
        return { ...result, [outcome]: [...result[outcome], relative(HOME, page)] };
      },
      { moved: [], removed: [] }
    );
};

const moveQueues = (): 'moved' | 'dropped' | 'absent' => {
  if (!existsSync(QUEUES.from)) {
    return 'absent';
  }
  if (existsSync(QUEUES.to)) {
    rmSync(QUEUES.from, { recursive: true });
    return 'dropped';
  }
  renameSync(QUEUES.from, QUEUES.to);
  return 'moved';
};

/** Writes the file a symlink points at through a temp file, keeping its mode. */
const writeAtomic = (file: string, text: string): void => {
  const target = realpathSync(file);
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, text, { mode: statSync(target).mode & 0o777 });
  renameSync(temp, target);
};

const migrateRules = (rules: unknown): unknown =>
  Array.isArray(rules) && rules.every((rule): rule is string => typeof rule === 'string')
    ? migrateGrants(rules, PLUGIN_NAME)
    : rules;

/** A settings file's migrated text, planned before anything in the home changes. */
interface SettingsPlan {
  file: string;
  text: string;
}

const planGrants = (name: string): SettingsPlan | null => {
  const file = resolve(HOME, '.claude', name);
  if (!existsSync(file)) {
    return null;
  }
  let settings: unknown;
  try {
    settings = JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    throw new Error(`${file} is not valid JSON; fix it, then run the upgrade again`);
  }
  if (!isRecord(settings) || !isRecord(settings.permissions)) {
    return null;
  }
  const { permissions } = settings;
  const next = {
    ...permissions,
    ...Object.fromEntries(
      LISTS.filter((list) => list in permissions).map((list) => [list, migrateRules(permissions[list])])
    )
  };
  if (JSON.stringify(next) === JSON.stringify(permissions)) {
    return null;
  }
  return { file, text: `${JSON.stringify({ ...settings, permissions: next }, null, 2)}\n` };
};

try {
  const plans = ['settings.json', 'settings.local.json']
    .map(planGrants)
    .filter((plan): plan is SettingsPlan => plan !== null);
  const pages = movePages();
  const queues = moveQueues();
  plans.forEach(({ file, text }) => writeAtomic(file, text));
  const grants = plans.map(({ file }) => relative(HOME, file));
  process.stdout.write(JSON.stringify({ ok: true, version: VERSION, pages, queues, grants }) + '\n');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(JSON.stringify({ ok: false, version: VERSION, error: message }) + '\n');
  process.exit(1);
}
