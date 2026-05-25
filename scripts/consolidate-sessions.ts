#!/usr/bin/env bun
/**
 * One-off migration: consolidate suffixed session files (legacy multi-user)
 * into single daily files matching the single-user `YYYY-MM-DD.md` shape.
 *
 * For each date that has multiple files (e.g. `2026-05-17.md`,
 * `2026-05-17-<user>.md`, `2026-05-17-cli.md`, `2026-05-17_0.md`) —
 * concatenate session blocks sorted by `(HH:MM)` timestamp, write to
 * `YYYY-MM-DD.md`, delete the suffixed copies.
 *
 * Also reconciles `~/.kevin/knowledge.json`: the merged file gets a fresh
 * hash; old suffixed entries are removed. A date that had at least one
 * suffixed entry already ingested gets the merged file marked ingested too
 * (preserves the "don't re-compile what's already in the wiki" invariant).
 *
 * Usage:
 *   KEVIN_HOME=/path/to/agent bun scripts/consolidate-sessions.ts            # dry run
 *   KEVIN_HOME=/path/to/agent bun scripts/consolidate-sessions.ts --apply    # do it
 *
 * Sessions only. Memory daily files have a different structure (no
 * `### Session (HH:MM)` block headers) and would lose content if run through
 * this script. Memory consolidation is one-pick-per-date — handled separately.
 */
import { FILES, FOLDERS } from '@/config';
import { hashBuffer } from '@/knowledge/utils';
import { nowISO } from '@/shared/date';
import type { CompileState } from '@/shared/types';
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APPLY = process.argv.includes('--apply');

const DATE_RE = /^(\d{4}-\d{2}-\d{2})(.*)\.md$/;
const TIME_RE = /^### Session \((\d{2}):(\d{2})\)/m;

interface Group {
  date: string;
  files: string[]; // basenames
}

const groupByDate = (files: string[]): Group[] => {
  const map = new Map<string, string[]>();
  for (const f of files) {
    const m = f.match(DATE_RE);
    if (!m) continue;
    const list = map.get(m[1]) ?? [];
    list.push(f);
    map.set(m[1], list);
  }
  return [...map.entries()]
    .filter(([, fs]) => fs.length > 1)
    .map(([date, fs]) => ({ date, files: fs.sort() }));
};

const splitBlocks = (content: string): string[] => {
  const idx = content.search(/^### Session/m);
  if (idx === -1) return [];
  return content.slice(idx).split(/(?=^### Session)/m).filter((b) => b.trim());
};

const blockTime = (block: string): number => {
  const m = block.match(TIME_RE);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
};

const mergeGroup = (group: Group): string => {
  const allBlocks = group.files.flatMap((file) =>
    splitBlocks(readFileSync(resolve(FOLDERS.SESSIONS, file), 'utf-8'))
  );
  allBlocks.sort((a, b) => blockTime(a) - blockTime(b));
  return `# Session Log: ${group.date}\n\n${allBlocks.map((b) => b.trimEnd()).join('\n\n')}\n`;
};

const emptyState = (): CompileState => ({
  ingested: {},
  partial: {},
  in_flight: null,
  last_lint: null,
  query_count: 0
});

const loadState = (): CompileState =>
  existsSync(FILES.KNOWLEDGE_STATE) ? JSON.parse(readFileSync(FILES.KNOWLEDGE_STATE, 'utf-8')) : emptyState();

const main = () => {
  const all = readdirSync(FOLDERS.SESSIONS).filter((f) => f.endsWith('.md'));
  const groups = groupByDate(all);

  if (groups.length === 0) {
    console.log('Nothing to consolidate — all dates have at most one file.');
    return;
  }

  console.log(`${APPLY ? 'Applying' : 'Plan'} (${groups.length} dates):\n`);

  const state = loadState();
  let merged = 0;
  let deleted = 0;

  for (const group of groups) {
    const target = `${group.date}.md`;
    const others = group.files.filter((f) => f !== target);
    const mergedContent = mergeGroup(group);
    const newHash = hashBuffer(mergedContent);

    const previouslyIngested = group.files.some((f) => state.ingested[f]);

    console.log(`  ${group.date}:  merge ${group.files.length} files (${group.files.join(', ')}) → ${target}`);
    if (previouslyIngested) console.log(`           ingested before → keep merged file marked ingested`);

    if (!APPLY) continue;

    writeFileSync(resolve(FOLDERS.SESSIONS, target), mergedContent, 'utf-8');
    merged++;

    for (const f of others) {
      unlinkSync(resolve(FOLDERS.SESSIONS, f));
      delete state.ingested[f];
      deleted++;
    }

    if (previouslyIngested) {
      state.ingested[target] = { hash: newHash, compiled_at: nowISO(), cost_usd: 0 };
    } else {
      delete state.ingested[target];
    }
  }

  if (APPLY) {
    writeFileSync(FILES.KNOWLEDGE_STATE, JSON.stringify(state, null, 2));
    console.log(`\n✅ Merged ${merged} dates · deleted ${deleted} files · state updated`);
  } else {
    console.log(`\nDry run. Re-run with --apply to execute.`);
  }
};

main();
