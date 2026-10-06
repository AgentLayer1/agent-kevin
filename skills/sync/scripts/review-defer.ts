#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { todayDate } from '../../../mcp-server/src/shared/date';
import { agentHomePath, isAgentHome } from '../../../mcp-server/src/shared/env';
import { agentKeyName, runtimeDirName } from '../../../mcp-server/src/shared/naming';
import { writeFileAtomic } from '../../../mcp-server/src/shared/utils';

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
// A missing watermark starts empty; a damaged one is left alone, since it holds the restore pointers.
const current = ((): Record<string, unknown> => {
  if (!existsSync(file)) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Unparseable falls through to the refusal below.
  }
  console.error(`${file} is not a JSON object; fix it before deferring the review`);
  process.exit(1);
})();
const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const skips = typeof current.skips === 'number' ? current.skips : 0;
const next: Record<string, unknown> =
  choice === 'tomorrow' ? { ...current, snoozeUntil: tomorrow } : { ...current, skippedOn: today, skips: skips + 1 };
writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
console.log(JSON.stringify({ choice, snoozeUntil: next.snoozeUntil ?? null, skippedOn: next.skippedOn ?? null }));
