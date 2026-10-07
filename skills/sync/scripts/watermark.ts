#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RUNTIME_DIR, agentKeyName } from "../../../mcp-server/src/shared/naming";
import { agentHomePath, isAgentHome } from "../../../mcp-server/src/shared/env";
import { RETIRED_CADENCE_KEYS } from "../../../mcp-server/src/shared/retired-skills";

/**
 * Stamp a cadence watermark: `bun watermark.ts <key> <YYYY-MM-DD>` (`goals-week`,
 * `goals-month`, `goals-year`). Written by the goals playbooks once goals are saved; read by
 * cadence.ts (same dir). Read-modify-write preserves sibling watermarks.
 */

const [given, date] = process.argv.slice(2);
// A session that loaded a playbook before the update may still stamp an old key.
const key = given && Object.hasOwn(RETIRED_CADENCE_KEYS, given) ? RETIRED_CADENCE_KEYS[given] : given;
if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
  console.error("usage: watermark.ts <key> <YYYY-MM-DD>");
  process.exit(1);
}

const home = agentHomePath();
if (!isAgentHome(home)) {
  console.error(`not an agent home: ${home} — set ${agentKeyName("HOME")}`);
  process.exit(1);
}

const file = join(home, RUNTIME_DIR, "cadence.json");
const readJson = (): Record<string, string> => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
};
writeFileSync(file, JSON.stringify({ ...readJson(), [key]: date }, null, 2) + "\n");
