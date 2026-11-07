/**
 * The Bash sandbox can't open a port, reach Postgres or write a tool's cache, so the gate runs from the MCP server,
 * each step under its own tighter sandbox profile.
 */
import { configuredRepoPaths, FOLDERS } from '@/config';
import { checkoutsCarrying, pickCheckout } from '@/shared/checkouts';
import { defineTool, type ToolDef } from '@/shared/types';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';
import { throwawayPostgres } from '../gate/postgres';
import { type GateRequest, runGate } from '../gate/run';
import { readGateSettings } from '../gate/settings';
import type { StepSpec } from '../gate/steps';

const DEFAULT_TIMEOUT_SECONDS = 1_200;
const MAX_TIMEOUT_SECONDS = 1_800;

const checkoutSchema = z
  .string()
  .optional()
  .describe(
    'Checkout to gate, by folder name: a configured repo ("acme") or one of its sibling worktrees ("acme-my-feature", or "my-feature" for the primary repo). Defaults to the primary repo (AGENT_CODE_PATH).'
  );

const timeoutSchema = z
  .number()
  .int()
  .positive()
  .max(MAX_TIMEOUT_SECONDS)
  .optional()
  .describe(`Whole-call budget in seconds, default ${DEFAULT_TIMEOUT_SECONDS}.`);

const resolveCheckout = (name?: string): { checkout: string; repo: string } => {
  const checkout = pickCheckout(checkoutsCarrying(['package.json']), 'a package.json', name);
  const configured = configuredRepoPaths();
  const repo =
    configured.find((path) => path === checkout) ??
    configured.find(
      (path) => dirname(checkout) === dirname(path) && basename(checkout).startsWith(`${basename(path)}-`)
    ) ??
    checkout;
  return { checkout, repo };
};

const gateRequest = ({
  name,
  steps,
  timeoutSeconds,
  signal,
  withServices
}: {
  name: string | undefined;
  steps: StepSpec[];
  timeoutSeconds: number;
  signal: AbortSignal;
  withServices: boolean;
}): GateRequest => {
  const { checkout, repo } = resolveCheckout(name);
  const settings = readGateSettings(basename(repo));
  return {
    checkout,
    steps,
    logsRoot: join(FOLDERS.LOGS, 'gate', basename(checkout)),
    timeoutMs: timeoutSeconds * 1_000,
    signal,
    env: settings.env,
    writable: settings.writable,
    ...(withServices && settings.postgres && { services: throwawayPostgres(settings.postgres, checkout) }),
    storeFallbacks: [repo]
  };
};

export const tools: ToolDef[] = [
  defineTool({
    name: 'gate_run',
    description:
      "Run a repo's own package.json scripts yourself instead of handing the operator a `!` command: build, test, lint, typecheck, format checks, migrations. Steps run in the order given, each as `<pm> run <script>`, and the first failure skips the rest, as CI does. Each step runs isolated: it writes to the checkout only, can't read secrets or .env, has no internet and no Docker, and reaches no local service that was already running, only the throwaway Postgres the repo's gate settings ask for (<HOME>/scripts/gate/<repo>.json, which also holds CI-style placeholder env values). One gate per checkout; it refuses a checkout where dev tooling is running. `selftest` proves the isolation on this machine. Dependency changes need gate_install first.",
    inputSchema: {
      steps: z
        .array(z.string().min(1))
        .min(1)
        .describe('Script names in order, e.g. ["lint", "typecheck", "build", "test"], or ["selftest"].'),
      checkout: checkoutSchema,
      filter: z
        .string()
        .optional()
        .describe('Run every step in one workspace package (pnpm/bun --filter, npm --workspace), e.g. "@acme/utils".'),
      timeoutSeconds: timeoutSchema
    },
    handler: async ({ steps, checkout, filter, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS }, { signal }) =>
      runGate(
        gateRequest({
          name: checkout,
          steps: steps.map(
            (name): StepSpec =>
              name === 'selftest'
                ? { kind: 'selftest', name }
                : { kind: 'script', name, script: name, ...(filter !== undefined && { filter }) }
          ),
          timeoutSeconds,
          signal,
          withServices: true
        })
      )
  }),

  defineTool({
    name: 'gate_install',
    description:
      "Install a checkout's dependencies after a package.json change, isolated like gate_run except that it may reach the internet (HTTPS and DNS, for the registry). Always asks the operator first. Returns the lockfile diff stat; follow with gate_run.",
    askOnly: true,
    inputSchema: {
      checkout: checkoutSchema,
      timeoutSeconds: timeoutSchema
    },
    handler: async ({ checkout, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS }, { signal }) =>
      runGate(
        gateRequest({
          name: checkout,
          steps: [{ kind: 'install', name: 'install' }],
          timeoutSeconds,
          signal,
          withServices: false
        })
      )
  })
];
