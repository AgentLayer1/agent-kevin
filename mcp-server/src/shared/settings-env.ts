import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Hydrate `process.env` from every `.claude/settings*.json` `env` block on the
 * ancestor path of `start` (nearest wins, `settings.local.json` over `settings.json`);
 * whatever is already in the environment always wins. Claude Code injects this env
 * into its own sessions; the CLI and a Codex-launched server load it themselves.
 * Side-effect-free at import on purpose: it must run before the home is resolved,
 * because a settings block may be what names the home.
 */
export function loadSettingsEnv(start: string): void {
  let dir = resolve(start);
  for (;;) {
    for (const file of ['settings.local.json', 'settings.json']) {
      const path = resolve(dir, '.claude', file);
      if (!existsSync(path)) continue;
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { env?: Record<string, unknown> };
        for (const [key, value] of Object.entries(parsed.env ?? {})) {
          if (typeof value === 'string') process.env[key] ??= value;
        }
      } catch {
        // a malformed settings file contributes nothing; the CLI's `ping` shows the resolved paths
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}
