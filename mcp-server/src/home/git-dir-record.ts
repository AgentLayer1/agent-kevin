/**
 * Where a split home keeps its history, and whether a history is this home's own.
 *
 * The location is `AGENT_HOME_GIT_DIR` in `<home>/.claude/settings.local.json`, read from the file
 * rather than through `env()` because a long-lived MCP server's environment predates the setup it
 * has just run. Ownership is the `agent.home` stamp setup writes into the history's own git config
 * (see `stampClaims`): a history this feature didn't stamp, or one stamped for another folder that
 * still exists, is never touched.
 * A leaf on purpose (node builtins only), so skill scripts such as sync's commit-brain can import it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const HOME_GIT_DIR_KEY = 'AGENT_HOME_GIT_DIR';
export const HOME_BINDING_KEY = 'agent.home';

export const localSettingsPath = (home: string): string => join(home, '.claude', 'settings.local.json');

export const recordedGitDir = (home: string): string | null => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(localSettingsPath(home), 'utf-8'));
    const env = typeof parsed === 'object' && parsed !== null && 'env' in parsed ? parsed.env : undefined;
    const value = typeof env === 'object' && env !== null && HOME_GIT_DIR_KEY in env ? env[HOME_GIT_DIR_KEY] : undefined;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
};

export const canonicalPath = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

/** The home a history folder was set up for, or null when it isn't a history this feature made. */
export const boundHome = (gitDir: string): string | null => {
  try {
    return (
      execFileSync('git', ['--git-dir', gitDir, 'config', '--get', HOME_BINDING_KEY], {
        encoding: 'utf8',
        env: process.env,
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim() || null
    );
  } catch {
    return null;
  }
};

/** The history lives inside the home: a real `.git` directory rather than a link to a folder elsewhere. */
export const historyInside = (home: string): boolean => {
  try {
    return lstatSync(join(home, '.git')).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Whether a stamp claims this home: stamped for it; or kept inside it (a renamed or copied folder
 * carries its own history); or stamped for a folder that no longer exists (the home moved). A split
 * history stamped for another folder that still exists belongs to that folder.
 */
export const stampClaims = (bound: string | null, home: string): boolean =>
  bound !== null && (bound === canonicalPath(home) || historyInside(home) || !existsSync(bound));

export const ownsHome = (gitDir: string, home: string): boolean => stampClaims(boundHome(gitDir), home);
