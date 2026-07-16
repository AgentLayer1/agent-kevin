import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { ensureLoggedIn, launch, log, type Session, type Target } from './browser';

/**
 * Portable flow harness. A flow is `runFlow(targets, handler)` — it owns its own `targets` map;
 * the harness parses CLI args into `params`, loads the flow's `config.json` (QA fixtures — test
 * personas, scenarios, sandbox cards; readable + committed, unlike the deny-gated `.env` the
 * dispatcher injects for real secrets), picks `targets[params.env]` (default `local`), launches the
 * headed browser, waits for manual login if the target needs it, runs the handler, and always
 * closes the context. Targets + handlers live in each flow.
 *
 * Precedence a flow should apply per field: `params.x ?? process.env.SECRET ?? config.x ?? default`
 * — a one-off CLI override wins, then a secret overlay, then the committed fixture, then the fallback.
 */
export interface FlowContext<Config = Record<string, unknown>> {
  params: Record<string, string>;
  /** Parsed `config.json` sitting beside the flow's `index.ts` (`{}` if absent) — QA fixture data. */
  config: Config;
  target: Target;
  session: Session;
}

const parseArgs = (argv: readonly string[]): Record<string, string> => {
  const params: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      params[key] = next;
      index += 1;
    } else {
      params[key] = 'true';
    }
  }
  return params;
};

/** Load the flow's `config.json` (fixtures) from the given dir. `{}` if absent/unparseable. */
const loadConfig = <Config>(scriptDir: string): Config => {
  try {
    return JSON.parse(readFileSync(resolve(scriptDir, 'config.json'), 'utf-8')) as Config;
  } catch {
    return {} as Config;
  }
};

export const runFlow = async <Config = Record<string, unknown>>(
  targets: Record<string, Target>,
  handler: (context: FlowContext<Config>) => Promise<void>
): Promise<void> => {
  try {
    const params = parseArgs(process.argv.slice(2));
    const env = params.env ?? (targets.local ? 'local' : (Object.keys(targets)[0] ?? 'local'));
    const target = targets[env];
    if (!target) {
      throw new Error(`Unknown --env "${env}". Available: ${Object.keys(targets).join(', ')}.`);
    }

    if (target.guarded && params['confirm-prod'] !== 'true') {
      throw new Error(`Target "${target.name}" is guarded (real data). Re-run with --confirm-prod if you mean it.`);
    }
    if (target.needsTunnel) {
      log(`⚠ ${target.name}: local webhooks can't reach localhost — ensure a tunnel is up and the callback URL points at it, or status won't update.`);
    }

    // Flows live in folders (`flows/<name>/index.ts`) — name the run after the folder.
    const script = process.argv[1] ?? '';
    const flowName = /index\.[tj]s$/.test(script) ? basename(dirname(script)) : basename(script).replace(/\.[tj]s$/, '') || 'flow';
    const config = loadConfig<Config>(dirname(script));
    const session = await launch(target, flowName, { headless: params.headless === 'true' });
    try {
      await ensureLoggedIn(session, target);
      await handler({ params, config, target, session });
      log('✅ flow complete.');
    } finally {
      await session.context.close();
    }
  } catch (error) {
    console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
};
