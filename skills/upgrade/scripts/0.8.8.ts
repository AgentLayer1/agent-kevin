#!/usr/bin/env bun
/**
 * Upgrade migration for v0.8.8: the focus skill is now attention, so a home's focus files and tool
 * grants follow it.
 *
 * `projects/<slug>/focus.html` becomes `attention.html` (an existing `attention.html` wins and the old
 * page goes, since the dashboard re-renders it), the queue cache in `<data-dir>/focus/` moves to
 * `<data-dir>/attention/` (or is dropped when the new one exists: it refills on the next pull), and a
 * `focus_write` rule in either settings file's `allow`, `ask` or `deny` becomes `attention_write` in
 * the same list. `Skill(<plugin>:focus)` rules are left to the baseline reconcile, which maps retired
 * skills through `retired-skills.ts` on every upgrade.
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
import { FOLDERS, MCP_PREFIX } from '../../../mcp-server/src/config';

const VERSION = '0.8.8';

const HOME = resolve(process.env.AGENT_HOME?.trim() || process.cwd());
const TOOL = { from: `${MCP_PREFIX}focus_write`, to: `${MCP_PREFIX}attention_write` };
const QUEUES = { from: join(dirname(FOLDERS.ATTENTION_QUEUES), 'focus'), to: FOLDERS.ATTENTION_QUEUES };
const LISTS = ['allow', 'ask', 'deny'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const movePages = (): { moved: string[]; removed: string[] } => {
  const projects = existsSync(FOLDERS.PROJECTS)
    ? readdirSync(FOLDERS.PROJECTS, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    : [];
  const pages = projects
    .map((entry) => join(FOLDERS.PROJECTS, entry.name))
    .filter((dir) => existsSync(join(dir, 'focus.html')))
    .map((dir) => ({ from: join(dir, 'focus.html'), to: join(dir, 'attention.html') }));
  const outcomes = pages.map(({ from, to }) => {
    if (existsSync(to)) {
      rmSync(from);
      return { outcome: 'removed' as const, path: relative(HOME, from) };
    }
    renameSync(from, to);
    return { outcome: 'moved' as const, path: relative(HOME, from) };
  });
  return {
    moved: outcomes.filter((item) => item.outcome === 'moved').map((item) => item.path),
    removed: outcomes.filter((item) => item.outcome === 'removed').map((item) => item.path)
  };
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

const renameRules = (rules: unknown): unknown =>
  Array.isArray(rules)
    ? rules
        .map((rule) => (rule === TOOL.from ? TOOL.to : rule))
        .filter((rule, index, all) => rule !== TOOL.to || all.indexOf(TOOL.to) === index)
    : rules;

const moveGrants = (name: string): string | null => {
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
      LISTS.filter((list) => list in permissions).map((list) => [list, renameRules(permissions[list])])
    )
  };
  if (JSON.stringify(next) === JSON.stringify(permissions)) {
    return null;
  }
  writeAtomic(file, `${JSON.stringify({ ...settings, permissions: next }, null, 2)}\n`);
  return relative(HOME, file);
};

try {
  const pages = movePages();
  const queues = moveQueues();
  const grants = ['settings.json', 'settings.local.json']
    .map(moveGrants)
    .filter((file): file is string => file !== null);
  process.stdout.write(JSON.stringify({ ok: true, version: VERSION, pages, queues, grants }) + '\n');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(JSON.stringify({ ok: false, version: VERSION, error: message }) + '\n');
  process.exit(1);
}
