#!/usr/bin/env bun
import { agentHomePath, isAgentHome } from "../../../mcp-server/src/shared/env";
import { commitBrain } from "./commit-brain";

/**
 * Sync's first step: commit whatever the home holds before the run as one commit, under the same
 * guards as commit-brain.ts, so the run's own changes land as a clean diff and the snapshot is a
 * restore point if the run goes wrong. A script of its own so the sync band can tell it from the closing commit.
 *
 * Usage: bun snapshot-brain.ts — prints a single JSON result for the skill to render.
 */
if (import.meta.main) {
  const home = agentHomePath();
  if (!isAgentHome(home)) {
    console.error(`not an agent home: ${home} — set AGENT_HOME`);
    process.exit(1);
  }
  console.log(JSON.stringify(commitBrain(home, { start: true })));
}
