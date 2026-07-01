#!/usr/bin/env bun
/**
 * Upgrade migration for v0.3.6 — narrow the .env deny so .env.example reads.
 *
 * The deny baseline shipped a catch-all `Read(**\/.env.*)` that also blocked safe
 * template files (.env.example, .env.sample). Claude Code evaluates deny before
 * allow with no glob negation, so the only way to whitelist one file is to narrow
 * the deny itself. This swaps the catch-all for explicit denies of the
 * secret-bearing variants, leaving example/sample files readable.
 *
 * Surgical + conservative: acts only when the exact broad rule is present, so an
 * operator who removed or customized their .env denies is left untouched. `**\/.env`
 * (the bare file) stays denied. Idempotent — a home already on the new baseline is a
 * no-op.
 *
 * Contract: prints a single-line JSON report as its LAST stdout line; exits
 * non-zero on failure. Self-contained, idempotent, fail-loud.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HOME = process.env.KEVIN_HOME?.trim() || process.cwd();
const SETTINGS_PROJECT = resolve(HOME, '.claude', 'settings.json');

const BROAD_DENY = 'Read(**/.env.*)';
const NARROW_DENY_RULES = [
  'Read(**/.env.local)',
  'Read(**/.env.*.local)',
  'Read(**/.env.development)',
  'Read(**/.env.production)',
  'Read(**/.env.staging)',
  'Read(**/.env.test)'
];

const readJson = (path: string): Record<string, unknown> =>
  existsSync(path) ? (JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>) : {};

function main(): void {
  const project = readJson(SETTINGS_PROJECT);

  const permissions = (
    project.permissions && typeof project.permissions === 'object' ? project.permissions : {}
  ) as Record<string, unknown>;
  const deny = Array.isArray(permissions.deny) ? (permissions.deny as string[]) : [];

  const hasBroad = deny.includes(BROAD_DENY);
  let settingsTouched = false;

  if (hasBroad) {
    const next = deny.flatMap((rule) =>
      rule === BROAD_DENY ? NARROW_DENY_RULES.filter((narrow) => !deny.includes(narrow)) : [rule]
    );
    permissions.deny = next;
    project.permissions = permissions;
    writeFileSync(SETTINGS_PROJECT, JSON.stringify(project, null, 2) + '\n');
    settingsTouched = true;
  }

  const report = { ok: true, version: '0.3.6', replacedBroadDeny: hasBroad, settingsTouched };
  process.stdout.write(JSON.stringify(report) + '\n');
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(JSON.stringify({ ok: false, version: '0.3.6', error: message }) + '\n');
  process.exit(1);
}
