/**
 * codex_setup — write this home's Codex wiring from outside the Bash sandbox.
 *
 * The generator lives at `skills/init/scripts/codex-setup.ts`; init and upgrade delegate
 * to this tool because a Codex session's sandbox keeps the workspace's `.codex/`
 * directory read-only, so the wiring cannot be regenerated from the model's shell there.
 * The MCP server is its own process, outside that sandbox, the same seam `run_upgrade`
 * and `setup_worktree` use.
 */
import { FOLDERS } from '@/config';
import { defineTool, type ToolDef } from '@/shared/types';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const SCRIPT_TIMEOUT_MS = 60_000;

interface SetupResult {
  ok: boolean;
  exitCode: number;
  report?: unknown;
  stderr?: string;
  message: string;
}

export const tools: ToolDef[] = [
  defineTool({
    name: 'codex_setup',
    description:
      "Generate or regenerate this home's Codex wiring (.codex/hooks.json, the MCP registration and permission profile in .codex/config.toml, and .codex/rules/<agent>.rules) from the plugin checkout and the home's Claude settings. Runs outside the Bash sandbox, which is what lets it write .codex/ from a Codex session. Called by init and upgrade; returns the generator's report, whose hooks.changed means the operator must re-trust the hook entries in /hooks.",
    inputSchema: {},
    handler: async (): Promise<SetupResult> => {
      const script = resolve(FOLDERS.ROOT, 'skills', 'init', 'scripts', 'codex-setup.ts');
      const proc = spawnSync(
        process.execPath,
        [script, '--home', FOLDERS.HOME, '--plugin-root', FOLDERS.ROOT, '--write'],
        { cwd: FOLDERS.HOME, encoding: 'utf-8', timeout: SCRIPT_TIMEOUT_MS }
      );
      const exitCode = proc.status ?? -1;
      const stdout = (proc.stdout ?? '').trim();
      let report: unknown;
      try {
        report = stdout ? JSON.parse(stdout.split('\n').at(-1) ?? '') : undefined;
      } catch {
        report = undefined;
      }
      return {
        ok: exitCode === 0,
        exitCode,
        report,
        stderr: (proc.stderr ?? '').slice(-2000),
        message:
          exitCode === 0 ? 'Codex wiring written.' : `Codex wiring failed (exit ${exitCode}); nothing was changed.`
      };
    }
  })
];
