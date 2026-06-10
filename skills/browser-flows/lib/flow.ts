import { basename, dirname } from 'node:path';
import { ensureLoggedIn, launch, log, type Session, type Target } from './browser';

/**
 * Portable flow harness. A flow is `runFlow(targets, handler)` — it owns its own `targets` map;
 * the harness parses CLI args into `params`, picks `targets[params.env]` (default `local`),
 * launches the headed browser, waits for manual login if the target needs it, runs the handler,
 * and always closes the context. Targets + handlers live in each flow.
 */
export interface FlowContext {
  params: Record<string, string>;
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

export const runFlow = async (
  targets: Record<string, Target>,
  handler: (context: FlowContext) => Promise<void>
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
    const session = await launch(target, flowName, { headless: params.headless === 'true' });
    try {
      await ensureLoggedIn(session, target);
      await handler({ params, target, session });
      log('✅ flow complete.');
    } finally {
      await session.context.close();
    }
  } catch (error) {
    console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
};
