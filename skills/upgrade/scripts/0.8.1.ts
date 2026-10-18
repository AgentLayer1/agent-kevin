#!/usr/bin/env bun
/**
 * Upgrade migration for v0.8.1: the agent's media and the home's browser flows leave `.claude/`,
 * which keeps only what Claude Code itself reads.
 *
 * `.claude/assets/*` moves to `assets/` and `.claude/browser-flows/<flow>` to `scripts/browser/<flow>`
 * (its `.env` with it). An entry already at the destination is dropped from the old folder when
 * identical, and left in both places and reported when not. IDENTITY.md's avatar links follow the
 * files that moved, since the upgrade never reconciles the persona block.
 *
 * Run by `/agent-kevin:upgrade` via `run_upgrade` (outside the Bash sandbox). Idempotent.
 * Contract: prints a single-line JSON report as its LAST stdout line; exits non-zero on failure.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { KNOWLEDGE } from '../../../mcp-server/src/config';

const VERSION = '0.8.1';

const HOME = resolve(process.env.AGENT_HOME?.trim() || process.cwd());
const IDENTITY = resolve(HOME, 'IDENTITY.md');
const ASSETS = { from: resolve(HOME, '.claude', 'assets'), to: resolve(HOME, 'assets') };
const FLOWS = { from: resolve(HOME, '.claude', 'browser-flows'), to: resolve(HOME, 'scripts', 'browser') };

type Outcome = 'moved' | 'deduped' | 'conflicts';

const visible = (dir: string): string[] => readdirSync(dir).filter((name) => !KNOWLEDGE.IGNORED_FILES.has(name));

const digest = (path: string): string => {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    return `link:${readlinkSync(path)}`;
  }
  const hash = createHash('sha256');
  return stat.isDirectory()
    ? hash
        .update(
          visible(path)
            .sort()
            .map((name) => `${name}:${digest(join(path, name))}`)
            .join('\n')
        )
        .digest('hex')
    : hash.update(readFileSync(path)).digest('hex');
};

const settle = (source: string, target: string): Outcome => {
  if (!existsSync(target)) {
    renameSync(source, target);
    return 'moved';
  }
  if (digest(source) !== digest(target)) {
    return 'conflicts';
  }
  rmSync(source, { recursive: true });
  return 'deduped';
};

const moveEntries = ({ from, to }: typeof ASSETS): { outcome: Outcome; path: string }[] => {
  if (!existsSync(from)) {
    return [];
  }
  mkdirSync(to, { recursive: true });
  const outcomes = visible(from).map((name) => ({
    outcome: settle(join(from, name), join(to, name)),
    path: relative(HOME, join(from, name))
  }));
  if (visible(from).length === 0) {
    rmSync(from, { recursive: true });
  }
  return outcomes;
};

// Only a link whose file left the old folder is repointed; a conflicting avatar keeps its old link.
const repointIdentity = (): boolean => {
  if (!existsSync(IDENTITY)) {
    return false;
  }
  const text = readFileSync(IDENTITY, 'utf-8');
  const next = text.replace(/\.claude\/assets\/([^)\s`]+)/g, (link, name: string) =>
    existsSync(join(ASSETS.to, name)) && !existsSync(join(ASSETS.from, name)) ? `assets/${name}` : link
  );
  if (next === text) {
    return false;
  }
  writeFileSync(IDENTITY, next);
  return true;
};

try {
  const outcomes = [ASSETS, FLOWS].flatMap(moveEntries);
  const pathsWith = (outcome: Outcome): string[] =>
    outcomes.filter((item) => item.outcome === outcome).map((item) => item.path);
  const identityRewritten = repointIdentity();
  process.stdout.write(
    JSON.stringify({
      ok: true,
      version: VERSION,
      moved: pathsWith('moved'),
      deduped: pathsWith('deduped'),
      conflicts: pathsWith('conflicts'),
      identityRewritten
    }) + '\n'
  );
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(JSON.stringify({ ok: false, version: VERSION, error: message }) + '\n');
  process.exit(1);
}
