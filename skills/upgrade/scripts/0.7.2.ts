#!/usr/bin/env bun
/**
 * Upgrade migration for v0.7.2: the Xcode pack stops gating `RunCodeSnippet`.
 *
 * The pack allows `mcp__xcode__*` and used to hold `RunCodeSnippet` and `InvokeDebuggerCommand`
 * in `ask`. The snippet tool adds nothing the allowed test and run tools can't already do, so its
 * `ask` entry is dropped from `.claude/settings.json`, since the upgrade's settings merge only adds.
 * The debugger gate and every other entry keep their place.
 *
 * Run by `/agent-kevin:upgrade` via `run_upgrade` (outside the Bash sandbox). Idempotent.
 * Contract: prints a single-line JSON report as its LAST stdout line; exits non-zero on failure.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VERSION = '0.7.2';
const UNGATED = 'mcp__xcode__RunCodeSnippet';

const HOME = resolve(process.env.AGENT_HOME?.trim() || process.cwd());
const SETTINGS = resolve(HOME, '.claude', 'settings.json');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const ungateSnippet = (): string[] => {
  if (!existsSync(SETTINGS)) {
    return [];
  }
  const settings: unknown = JSON.parse(readFileSync(SETTINGS, 'utf-8'));
  const permissions = isRecord(settings) ? settings.permissions : undefined;
  const ask = isRecord(permissions) ? permissions.ask : undefined;
  if (!isRecord(settings) || !isRecord(permissions) || !Array.isArray(ask) || !ask.includes(UNGATED)) {
    return [];
  }
  writeFileSync(
    SETTINGS,
    `${JSON.stringify({ ...settings, permissions: { ...permissions, ask: ask.filter((entry) => entry !== UNGATED) } }, null, 2)}\n`
  );
  return [UNGATED];
};

try {
  process.stdout.write(JSON.stringify({ ok: true, version: VERSION, askDropped: ungateSnippet() }) + '\n');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(JSON.stringify({ ok: false, version: VERSION, error: message }) + '\n');
  process.exit(1);
}
