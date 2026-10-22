#!/usr/bin/env bun
import { join } from "node:path";
import { FOLDERS } from "../../../mcp-server/src/config";
import { agentHomePath, isAgentHome } from "../../../mcp-server/src/shared/env";
import { reviewReads } from "./profiles";

/**
 * Prints the App Store reads due for each queue profile with `appstore`, as JSON
 * `[{ slug, app, storefronts?, since }]`: since is the last complete read's through, else 7d.
 *
 * Usage: bun review-reads.ts
 */

const home = agentHomePath();
if (!isAgentHome(home)) {
  console.error(`not an agent home: ${home} — set AGENT_HOME`);
  process.exit(1);
}

console.log(JSON.stringify(reviewReads(FOLDERS.PROJECTS, join(FOLDERS.REPORTS, "helpdesk"))));
