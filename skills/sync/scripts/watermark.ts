#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDirOf } from "../../../mcp-server/src/shared/naming";
import { agentHomePath, isAgentHome } from "../../../mcp-server/src/shared/env";

/**
 * Stamp a cadence watermark: `bun watermark.ts <key> <YYYY-MM-DD>` (`goals-week`,
 * `goals-month`, `goals-year`). Written by the goals playbooks once goals are saved; read by
 * cadence.ts (same dir). Read-modify-write preserves sibling watermarks.
 */

const [key, date] = process.argv.slice(2);
if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
  console.error("usage: watermark.ts <key> <YYYY-MM-DD>");
  process.exit(1);
}

const home = agentHomePath();
if (!isAgentHome(home)) {
  console.error(`not an agent home: ${home} — set AGENT_HOME`);
  process.exit(1);
}

const file = join(dataDirOf(home), "cadence.json");
const readJson = (): Record<string, string> => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
};
writeFileSync(file, JSON.stringify({ ...readJson(), [key]: date }, null, 2) + "\n");
