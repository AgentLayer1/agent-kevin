/**
 * run_upgrade — generic executor for versioned upgrade migrations.
 *
 * Heavy, one-time HOME migrations ship as `skills/upgrade/scripts/<version>.ts`,
 * named for the release that introduced them. The `/agent-kevin:upgrade` skill
 * delegates each `script:` action in the CHANGELOG to this tool. Like
 * `setup_worktree`, it runs OUTSIDE the Bash command sandbox, so a migration can
 * write the deny-gated `.kevin/secrets/`, read `settings.local.json`, and
 * read-verify the result — none of which a sandboxed Bash script could do.
 *
 * The tool is GENERIC: it carries no per-version logic. It validates the version,
 * resolves the script by name, spawns it with bun, and returns its JSON report.
 * New migrations are a new script file + one CHANGELOG line — no change here.
 */
import { FOLDERS } from '@/config';
import { defineTool, type ToolDef } from '@/shared/types';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const SCRIPT_TIMEOUT_MS = 120_000;

/**
 * Resolve a version to `<PLUGIN_ROOT>/skills/upgrade/scripts/<version>.ts`, or null
 * when the version is malformed (the semver allowlist rejects path traversal — a bare
 * `MAJOR.MINOR.PATCH` can't contain `/` or `..`). Existence is the caller's concern:
 * an absent file is a legitimate "already applied / pruned" state, not a bad input.
 */
function resolveUpgradeScript(version: string): string | null {
  if (!SEMVER_RE.test(version)) return null;
  return resolve(FOLDERS.ROOT, 'skills', 'upgrade', 'scripts', `${version}.ts`);
}

interface RunResult {
  ok: boolean;
  found: boolean;
  version: string;
  exitCode?: number;
  report?: unknown;
  stdout?: string;
  stderr?: string;
  message: string;
}

/** Parse the migration's JSON report — the last non-empty stdout line. */
function parseReport(stdout: string): unknown {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) return undefined;
  try {
    return JSON.parse(last);
  } catch {
    return undefined;
  }
}

export const tools: ToolDef[] = [
  defineTool({
    name: 'run_upgrade',
    description:
      "Run the versioned upgrade migration at skills/upgrade/scripts/<version>.ts, outside the Bash sandbox (so it can touch deny-gated paths). Called by /agent-kevin:upgrade for each `script:` action in the CHANGELOG. Generic — no per-version logic. Returns the script's JSON report; a missing script means already-applied/pruned (found:false), not an error.",
    inputSchema: {
      version: z
        .string()
        .describe('Semver MAJOR.MINOR.PATCH of the migration to run (resolves skills/upgrade/scripts/<version>.ts).')
    },
    handler: async ({ version }): Promise<RunResult> => {
      const scriptPath = resolveUpgradeScript(version);
      if (!scriptPath) {
        return {
          ok: false,
          found: false,
          version,
          message: `Invalid version "${version}" — expected MAJOR.MINOR.PATCH.`
        };
      }
      if (!existsSync(scriptPath)) {
        return {
          ok: true,
          found: false,
          version,
          message: `No migration script for ${version} (already applied or pruned) — skipped.`
        };
      }

      const proc = spawnSync(process.execPath, [scriptPath], {
        cwd: FOLDERS.HOME,
        env: { ...process.env, KEVIN_HOME: FOLDERS.HOME, KEVIN_PLUGIN_ROOT: FOLDERS.ROOT },
        encoding: 'utf-8',
        timeout: SCRIPT_TIMEOUT_MS
      });

      const stdout = proc.stdout ?? '';
      const stderr = (proc.stderr ?? '').slice(-2000);
      const exitCode = proc.status ?? -1;
      const ok = exitCode === 0;
      return {
        ok,
        found: true,
        version,
        exitCode,
        report: parseReport(stdout),
        stdout: stdout.slice(-2000),
        stderr,
        message: ok ? `Migration ${version} completed.` : `Migration ${version} failed (exit ${exitCode}).`
      };
    }
  })
];
