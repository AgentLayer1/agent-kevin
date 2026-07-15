/**
 * browser-flows MCP tool — runs any flow's `index.ts` from inside the MCP server process. The
 * server is spawned by Claude Code (not the Bash-tool seatbelt), so the headed browser a flow opens
 * isn't blocked by the sandbox that stops `bun run` from a Bash call. Generic + portable: it
 * discovers flows by listing folders and passes `params` through as `--key value`.
 *
 * Flows resolve from two roots: the plugin's built-in `flows/` (shipped, e.g. `hacker-news`) and the
 * operator's HOME `.claude/browser-flows/` (private, per-operator, never distributed — the place for
 * flows that drive a specific/local app). A HOME flow shadows a built-in of the same name. HOME
 * flows import the harness as a bare specifier (`import { runFlow } from 'lib/flow'`) — the plugin's
 * `browser-flows` dir is added to NODE_PATH so that resolves wherever the flow lives.
 *
 * Credentials: a flow that needs secrets (a card, a password, an API key) reads them from
 * `process.env`, never from `params`. The dispatcher loads `<HOME>/.claude/browser-flows/<flow>/.env`
 * (always HOME, gitignored, deny-gated from the agent's own Read/Bash) and injects it into ONLY that
 * flow's child process — scoped, so one flow's secrets don't reach another, and never routed through
 * a tool param into the conversation. Flow secrets override inherited env; the harness vars
 * (NODE_PATH/KEVIN_HOME/…) always win over both. The reader refuses `.kevin/secrets/` by construction.
 */

import { FOLDERS } from '@/config';
import { readEnvFile } from '@/shared/env';
import { defineTool, type ToolDef } from '@/shared/types';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { z } from 'zod';

const BROWSER_FLOWS_DIR = resolve(FOLDERS.ROOT, 'skills', 'browser-flows');
const BUILTIN_FLOWS_DIR = resolve(BROWSER_FLOWS_DIR, 'flows');
const LOCAL_FLOWS_DIR = resolve(FOLDERS.HOME, '.claude', 'browser-flows');
const MAX_OUTPUT_CHARS = 8_000;

const flowsIn = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(resolve(dir, entry.name, 'index.ts')))
        .map((entry) => entry.name)
    : [];

const listFlows = (): string[] => [...new Set([...flowsIn(LOCAL_FLOWS_DIR), ...flowsIn(BUILTIN_FLOWS_DIR)])].sort();

/** Resolve a flow name to the root that holds it, HOME first (so a HOME flow shadows a built-in of
 *  the same name). Null if it's in neither root. Traversal is a non-issue — `flow` is `[a-z0-9-]+`. */
const resolveFlowRoot = (flow: string): string | null =>
  [LOCAL_FLOWS_DIR, BUILTIN_FLOWS_DIR].find((dir) => existsSync(resolve(dir, flow, 'index.ts'))) ?? null;

const toFlags = (params: Record<string, string | number | boolean>): string[] =>
  Object.entries(params).flatMap(([key, value]) => {
    if (value === false) {
      return [];
    }
    return value === true ? [`--${key}`] : [`--${key}`, String(value)];
  });

const tail = (text: string, limit: number): string =>
  text.length <= limit ? text : `…(${text.length - limit} chars trimmed)\n${text.slice(-limit)}`;

// A flow's `index.md` is its guidance — injected into the result each run so the flow can give the
// agent direction (e.g. "read these source files to navigate the site").
const readGuidance = (flowDir: string): string => {
  const guidancePath = resolve(flowDir, 'index.md');
  return existsSync(guidancePath) ? readFileSync(guidancePath, 'utf8').trim() : '';
};

export const tools: ToolDef[] = [
  defineTool({
    name: 'browser_flows',
    description:
      'Run a browser-flows flow that drives a site in a VISIBLE browser (the operator can log in manually when a flow needs it — no API keys). Runs inside the MCP server so the headed browser launches outside the Bash sandbox. flow = a folder with an index.ts, resolved from the plugin\'s skills/browser-flows/flows/ (built-in, e.g. hacker-news) or the operator\'s HOME .claude/browser-flows/ (private, e.g. an app-specific flow); HOME shadows built-in. params map to --key value — use params ONLY for non-secret knobs (env, tier, count). SECRETS (cards, passwords, tokens) go in <HOME>/.claude/browser-flows/<flow>/.env, which the tool loads and injects into that flow alone; never pass a credential as a param. Long-running for interactive flows. Screenshots land in reports/captures/browser/<env>/<flow>/<run>/.',
    inputSchema: {
      flow: z.string().describe('Flow name — a folder with an index.ts under the plugin flows/ or HOME .claude/browser-flows/ (e.g. "hacker-news")'),
      params: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .default({})
        .describe('Flow args, mapped to --key value (e.g. { env: "web", count: 10 })')
    },
    handler: async ({ flow, params }) => {
      if (!/^[a-z0-9-]+$/.test(flow)) {
        throw new Error(`Invalid flow name "${flow}". Use lowercase letters, digits, and hyphens.`);
      }
      const flowRoot = resolveFlowRoot(flow);
      if (!flowRoot) {
        return { error: `Flow "${flow}" not found. Available: ${listFlows().join(', ') || '(none)'}` };
      }

      const nodeModules = resolve(FOLDERS.ROOT, 'mcp-server', 'node_modules');
      // browser-flows dir on NODE_PATH lets any flow (built-in or HOME) resolve the shared harness.
      const nodePath = [nodeModules, BROWSER_FLOWS_DIR].join(delimiter);
      // Flow secrets: always from HOME (never the distributed plugin repo), scoped to this flow's
      // child. Flow env overrides inherited values; the harness vars below win over the flow env.
      const flowEnv = readEnvFile(resolve(LOCAL_FLOWS_DIR, flow, '.env'));
      const proc = Bun.spawn(['bun', 'run', resolve(flowRoot, flow, 'index.ts'), ...toFlags(params)], {
        cwd: FOLDERS.ROOT,
        env: { ...process.env, ...flowEnv, NODE_PATH: nodePath, PLAYWRIGHT_BROWSERS_PATH: '0', KEVIN_HOME: FOLDERS.HOME },
        stdout: 'pipe',
        stderr: 'pipe'
      });

      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      const exitCode = await proc.exited;

      return {
        flow,
        exitCode,
        envKeys: Object.keys(flowEnv), // names only — the injected secret values never leave the child
        guidance: readGuidance(resolve(flowRoot, flow)),
        output: tail(`${stdout}${stderr}`.trim(), MAX_OUTPUT_CHARS)
      };
    }
  })
];
