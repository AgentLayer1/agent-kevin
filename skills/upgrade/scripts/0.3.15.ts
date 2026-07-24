#!/usr/bin/env bun
/**
 * Upgrade migration for v0.3.15 — seed KEVIN_HOME_TIMEZONE from USER.md.
 *
 * v0.3.15 splits USER.md's Timezone identity field into Home/Current timezone
 * and teaches the SessionStart hook to flag traveling when the live machine
 * timezone differs from KEVIN_HOME_TIMEZONE. Existing homes already state the
 * home timezone in USER.md, so this seeds `.claude/settings.local.json` `env`
 * from it. No-op when the key is already set or no valid IANA name is found.
 *
 * Contract: prints a single-line JSON report as its LAST stdout line; exits
 * non-zero on failure. Self-contained, idempotent, fail-loud.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HOME = process.env.KEVIN_HOME?.trim() || process.cwd();
const USER_MD = resolve(HOME, 'USER.md');
const SETTINGS_LOCAL = resolve(HOME, '.claude', 'settings.local.json');

const isValidTimezone = (name: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: name });
    return true;
  } catch {
    return false;
  }
};

/** First whitespace-delimited token of the field value that is a real IANA name. */
const homeTimezoneFromUserMd = (): string | null => {
  if (!existsSync(USER_MD)) {
    return null;
  }
  const content = readFileSync(USER_MD, 'utf-8');
  const value =
    content.match(/\*\*Home timezone:\*\*\s*(.+)$/m)?.[1] ?? content.match(/\*\*Timezone:\*\*\s*(.+)$/m)?.[1];
  const candidate = value?.trim().split(/\s+/)[0];
  return candidate && isValidTimezone(candidate) ? candidate : null;
};

function main(): void {
  const settings = existsSync(SETTINGS_LOCAL)
    ? (JSON.parse(readFileSync(SETTINGS_LOCAL, 'utf-8')) as Record<string, unknown>)
    : {};
  const env = (settings.env && typeof settings.env === 'object' ? settings.env : {}) as Record<string, unknown>;

  const existing = typeof env.KEVIN_HOME_TIMEZONE === 'string' ? env.KEVIN_HOME_TIMEZONE.trim() : '';
  if (existing) {
    process.stdout.write(JSON.stringify({ ok: true, version: '0.3.15', action: 'already-set', homeTimezone: existing }) + '\n');
    return;
  }

  const homeTimezone = homeTimezoneFromUserMd();
  if (!homeTimezone) {
    process.stdout.write(
      JSON.stringify({
        ok: true,
        version: '0.3.15',
        action: 'no-timezone-found',
        note: 'No valid IANA timezone in USER.md — set KEVIN_HOME_TIMEZONE in .claude/settings.local.json env by hand.'
      }) + '\n'
    );
    return;
  }

  env.KEVIN_HOME_TIMEZONE = homeTimezone;
  settings.env = env;
  writeFileSync(SETTINGS_LOCAL, JSON.stringify(settings, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ ok: true, version: '0.3.15', action: 'seeded', homeTimezone }) + '\n');
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(JSON.stringify({ ok: false, version: '0.3.15', error: message }) + '\n');
  process.exit(1);
}
