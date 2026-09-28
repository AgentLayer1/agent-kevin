#!/usr/bin/env bun
/**
 * Check a roadmap page after writing or editing it: `bun check.ts <roadmap.html>`.
 * Exits 1 with the errors when the roadmap-data block won't parse, isn't script-safe, or holds an
 * invalid status or date; warnings (undated milestones, items focus pages skip) print but pass.
 */
import { readFileSync } from 'node:fs';
import { checkRoadmapHtml } from '../../../mcp-server/src/roadmap/data';

const path = process.argv[2];
if (!path) {
  console.error('usage: bun check.ts <roadmap.html>');
  process.exit(2);
}
const { errors, warnings } = checkRoadmapHtml(readFileSync(path, 'utf-8'));
[...errors.map((line) => `error: ${line}`), ...warnings.map((line) => `warning: ${line}`)].forEach((line) => console.log(line));
console.log(errors.length ? `✗ ${errors.length} error(s) in ${path}` : `✓ ${path} (${warnings.length} warning(s))`);
process.exit(errors.length ? 1 : 0);
