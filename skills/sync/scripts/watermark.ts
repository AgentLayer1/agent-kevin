#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentHomePath, isAgentHome } from "../../../mcp-server/src/shared/env";

/**
 * Stamp a cadence watermark: `bun watermark.ts <skill> <YYYY-MM-DD>`.
 * Written by the goals skills once goals are actually saved; read by
 * cadence.ts (same dir). Read-modify-write preserves sibling watermarks.
 */

const [skill, date] = process.argv.slice(2);
if (!skill || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
  console.error("usage: watermark.ts <skill> <YYYY-MM-DD>");
  process.exit(1);
}

const home = agentHomePath();
if (!isAgentHome(home)) {
  console.error(`not an agent home: ${home} — set KEVIN_HOME`);
  process.exit(1);
}

const file = join(home, ".kevin/cadence.json");
const readJson = (): Record<string, string> => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
};
writeFileSync(file, JSON.stringify({ ...readJson(), [skill]: date }, null, 2) + "\n");
