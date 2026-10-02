#!/usr/bin/env bun
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { todayDate } from '../../../mcp-server/src/shared/date';
import { agentHomePath, isAgentHome } from '../../../mcp-server/src/shared/env';
import { agentKeyName, runtimeDirName } from '../../../mcp-server/src/shared/naming';

/**
 * Record the operator's answer to sync's "self-review is due" question: `tomorrow` holds it
 * off for a day, `skip` for a month and counts the skip. Read-modify-write keeps every other key.
 *
 * Usage: bun review-defer.ts <tomorrow|skip> [--today YYYY-MM-DD]
 */

const args = process.argv.slice(2);
const choice = args[0];
const today = args.includes('--today') ? (args[args.indexOf('--today') + 1] ?? '') : todayDate();
if ((choice !== 'tomorrow' && choice !== 'skip') || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
  console.error('usage: review-defer.ts <tomorrow|skip> [--today YYYY-MM-DD]');
  process.exit(1);
}

const home = agentHomePath();
if (!isAgentHome(home)) {
  console.error(`not an agent home: ${home} — set ${agentKeyName('HOME')}`);
  process.exit(1);
}

const file = join(home, runtimeDirName(), 'review.json');
const current = ((): Record<string, unknown> => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
})();
const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const skips = typeof current.skips === 'number' ? current.skips : 0;
const next =
  choice === 'tomorrow' ? { ...current, snoozeUntil: tomorrow } : { ...current, skippedOn: today, skips: skips + 1 };
writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
console.log(JSON.stringify({ choice, snoozeUntil: next.snoozeUntil ?? null, skippedOn: next.skippedOn ?? null }));
