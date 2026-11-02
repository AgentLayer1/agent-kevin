/**
 * run_upgrade — generic executor for versioned upgrade migrations.
 *
 * Heavy, one-time HOME migrations ship as `skills/upgrade/scripts/<version>.ts`,
 * named for the release that introduced them. The `/agent-kevin:upgrade` skill
 * delegates each `script:` action in the CHANGELOG to this tool. Like
 * `setup_worktree`, it runs OUTSIDE the Bash command sandbox, so a migration can
 * write the deny-gated data-dir `secrets/`, read `settings.local.json`, and
 * read-verify the result — none of which a sandboxed Bash script could do.
 *
 * The tool is GENERIC: it carries no per-version logic. It validates the version,
 * resolves the script by name, spawns it with bun, and returns its JSON report.
 * New migrations are a new script file + one CHANGELOG line — no change here.
 *
 * `install: true` runs the `deps:` action, `bun install` in the plugin's mcp-server, from the
 * same seat: a sandboxed shell can't write bun's cache, and the upgrade stamps its baseline only
 * once the install has run in the same turn.
 */
import { FOLDERS, PLUGIN_NAME } from '@/config';
import { defineTool, type ToolDef } from '@/shared/types';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const SCRIPT_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 600_000;
const OUTPUT_TAIL = 2000;

const execFileAsync = promisify(execFile);

const realpathOrNull = (path: string): string | null => {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};

/**
 * The plugin root `bun install` may run in: this server's own, or a sibling version folder in a
 * marketplace cache (`<marketplace>/<plugin>/<version>`), where an update lands while the
 * server still runs from the previous version. Null for anything else.
 */
export const installRoot = (requested: string, serverRoot: string): string | null => {
  const target = realpathOrNull(requested);
  const own = realpathOrNull(serverRoot);
  if (!target || !own) return null;
  if (target === own) return target;
  const siblingVersion =
    dirname(target) === dirname(own) &&
    SEMVER_RE.test(basename(target)) &&
    SEMVER_RE.test(basename(own)) &&
    existsSync(join(target, 'mcp-server', 'package.json'));
  return siblingVersion ? target : null;
};

interface InstallResult {
  ok: boolean;
  dir: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  message: string;
}

/**
 * Uses the bun running this server. Async, so the server keeps answering while the
 * postinstall downloads Chromium.
 */
export const installDeps = async (dir: string): Promise<InstallResult> => {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, ['install'], {
      cwd: dir,
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024
    });
    return {
      ok: true,
      dir,
      exitCode: 0,
      stdout: stdout.slice(-OUTPUT_TAIL),
      stderr: stderr.slice(-OUTPUT_TAIL),
      message: 'bun install completed.'
    };
  } catch (error) {
    const failure = error as {
      code?: number | string;
      killed?: boolean;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    const exitCode = typeof failure.code === 'number' ? failure.code : -1;
    return {
      ok: false,
      dir,
      exitCode,
      stdout: (failure.stdout ?? '').slice(-OUTPUT_TAIL),
      stderr: (failure.stderr || failure.message || String(error)).slice(-OUTPUT_TAIL),
      message: failure.killed
        ? `bun install timed out after ${INSTALL_TIMEOUT_MS / 60_000} minutes.`
        : `bun install failed (exit ${exitCode}).`
    };
  }
};

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
    description: `Run the versioned upgrade migration at skills/upgrade/scripts/<version>.ts, outside the Bash sandbox (so it can touch deny-gated paths). Called by /${PLUGIN_NAME}:upgrade for each \`script:\` action in the CHANGELOG. Generic — no per-version logic. Returns the script's JSON report; a missing script means already-applied/pruned (found:false), not an error. With install:true and pluginRoot instead of a version, runs the \`deps:\` action: bun install in that plugin root's mcp-server, also outside the sandbox (up to 10 minutes while Chromium downloads). pluginRoot must be this server's root or a sibling version folder of it in a marketplace cache.`,
    inputSchema: {
      version: z
        .string()
        .optional()
        .describe('Semver MAJOR.MINOR.PATCH of the migration to run (resolves skills/upgrade/scripts/<version>.ts).'),
      install: z
        .boolean()
        .optional()
        .describe("true runs bun install in pluginRoot's mcp-server instead of a migration. Never with version."),
      pluginRoot: z
        .string()
        .optional()
        .describe(
          'Required with install: the plugin root the upgrade skill loaded from ($PLUGIN_ROOT), which after a marketplace update can be a newer version folder than the one this server runs from.'
        ),
      options: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Choices the operator made for this migration, read by the script from AGENT_UPGRADE_OPTIONS (JSON). Only pass what the upgrade skill's step for that version names."
        )
    },
    handler: async ({ version, install, pluginRoot, options }): Promise<RunResult | InstallResult> => {
      if (install) {
        if (version !== undefined) {
          return { ok: false, found: false, version, message: 'Pass install or version, not both.' };
        }
        const root = pluginRoot === undefined ? null : installRoot(pluginRoot, FOLDERS.ROOT);
        if (!root) {
          return {
            ok: false,
            dir: pluginRoot ?? '',
            exitCode: -1,
            stdout: '',
            stderr: '',
            message: `Install refused: pluginRoot must be this server's plugin root (${FOLDERS.ROOT}) or a sibling version folder of it.`
          };
        }
        return installDeps(join(root, 'mcp-server'));
      }
      if (version === undefined) {
        return { ok: false, found: false, version: '', message: 'Pass a version, or install: true.' };
      }
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
        env: {
          ...process.env,
          AGENT_HOME: FOLDERS.HOME,
          AGENT_PLUGIN_ROOT: FOLDERS.ROOT,
          AGENT_UPGRADE_OPTIONS: JSON.stringify(options ?? {})
        },
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
