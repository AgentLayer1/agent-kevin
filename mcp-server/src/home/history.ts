/**
 * Home history — version history for the agent home, behind the `home_history` MCP tools and the
 * SessionStart link repair. There is no off switch: history is turned on once and kept. A home outside any cloud-synced folder gets a plain `.git`; a synced
 * one keeps its history in a local folder (`--separate-git-dir`), leaving only a one-line `.git`
 * link in the synced tree, because sync services damage git internals.
 *
 * This feature manages only the history it created: setup stamps the history with the home it
 * belongs to (`agent.home`, see `git-dir-record.ts`), and any other git setup, whether made by
 * hand, a copy of another home's, or an enclosing project, is left to the operator.
 *
 * Runs git via execFileSync (argv arrays, no shell). Through the MCP server this executes outside
 * the Bash sandbox, which refuses to create `.git` at the working-directory root.
 */
import { FOLDERS } from '@/config';
import { type SyncedBy, syncedBy } from '@/home/cloud-sync';
import {
  boundHome,
  canonicalPath,
  historyInside,
  HOME_BINDING_KEY,
  HOME_GIT_DIR_KEY,
  localSettingsPath,
  ownsHome,
  recordedGitDir,
  stampClaims
} from '@/home/git-dir-record';
import { reconcileHomeGitignore } from '@/home/gitignore';
import { log as baseLog } from '@/shared/log';
import { resolveEnv, runtimeDirName } from '@/shared/naming';
import { isInside } from '@/shared/paths';
import { writeFileAtomic } from '@/shared/utils';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const log = baseLog.with('history');

const FIRST_COMMIT_MESSAGE = 'History: first snapshot\n\nThe first saved version of this agent home.\n';

export type HistoryState =
  | 'off'
  | 'on'
  | 'pointer-missing'
  | 'history-missing'
  | 'managed-by-you'
  | 'git-missing';

export interface LastCommit {
  hash: string;
  subject: string;
  date: string;
}

export interface HistoryStatus {
  state: HistoryState;
  layout: 'in-place' | 'split' | null;
  gitDir: string | null;
  /** Checked only for a home without history, where it decides the layout. */
  homeSyncedBy: SyncedBy;
  /** Where setup will keep the history of a synced home (a local folder outside the home). */
  historyFolder: string | null;
  lastCommit: LastCommit | null;
  message: string;
}

export type SetupOutcome = 'turned-on' | 'already-on' | 'moved' | 'refused' | 'failed';

export interface SetupResult {
  outcome: SetupOutcome;
  status: HistoryStatus;
  settingsChanged: boolean;
  message: string;
}

export interface SetupOptions {
  /** Commit identity when the machine has none (repo-local, never global). */
  name?: string;
  /** Replace a record whose history folder is gone, after the operator asked to start over. */
  startOver?: boolean;
}

/** Seams for tests: where "home" is and how sync is detected. */
export interface HistoryEnv {
  userHome: string;
  syncedBy: (path: string) => SyncedBy;
}

const defaultEnv = (): HistoryEnv => ({ userHome: homedir(), syncedBy });

// Bun hands children its startup environment unless given one; pass the live one so a caller's
// GIT_* settings reach git.
const gitRaw = (home: string, args: string[], input?: string): string =>
  execFileSync('git', ['-C', home, ...args], {
    encoding: 'utf8',
    env: process.env,
    input,
    stdio: ['pipe', 'pipe', 'pipe']
  });

/** For scalar results; a NUL-separated path list goes through `gitRaw`, since a name can start with a space. */
const git = (home: string, args: string[], input?: string): string => gitRaw(home, args, input).trim();

const gitSucceeds = (home: string, args: string[]): boolean =>
  spawnSync('git', ['-C', home, ...args], { env: process.env, stdio: 'ignore' }).status === 0;

const tryGit = (home: string, args: string[]): string | null => {
  try {
    return git(home, args);
  } catch {
    return null;
  }
};

const errorText = (err: unknown): string => {
  const stderr = err instanceof Error && 'stderr' in err ? String(err.stderr).trim() : '';
  return stderr || (err instanceof Error ? err.message : String(err));
};

let gitReady = false;

/**
 * The command that installs git, or null when git is ready. On macOS it never runs git without
 * the Command Line Tools, which would pop the installer. A ready git is remembered for the process.
 */
const gitInstallHint = (): string | null => {
  if (gitReady) {
    return null;
  }
  const path = Bun.which('git');
  if (!path) {
    return process.platform === 'darwin' ? 'xcode-select --install' : 'install git from https://git-scm.com/downloads';
  }
  const needsTools = process.platform === 'darwin' && path === '/usr/bin/git';
  if (needsTools && spawnSync('xcode-select', ['-p'], { stdio: 'ignore' }).status !== 0) {
    return 'xcode-select --install';
  }
  gitReady = true;
  return null;
};

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readSettings = (home: string): Json => {
  const path = localSettingsPath(home);
  if (!existsSync(path)) {
    return {};
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  if (!isObject(parsed)) {
    throw new Error(`${path} is not a JSON object`);
  }
  return parsed;
};

const child = (parent: Json, key: string): Json => {
  const existing = parent[key];
  if (isObject(existing)) {
    return existing;
  }
  const created: Json = {};
  parent[key] = created;
  return created;
};

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** The grant pair init writes for the code root: Read/Edit/Write tools, then sandboxed Bash. */
const GRANT_PATHS: readonly (readonly string[])[] = [
  ['permissions', 'additionalDirectories'],
  ['sandbox', 'filesystem', 'allowWrite']
];

/** Record the split location with its grants, keeping the operator's entries. Returns whether the file changed. */
const recordLocation = (home: string, gitDir: string): boolean => {
  const settings = readSettings(home);
  const before = JSON.stringify(settings);
  child(settings, 'env')[HOME_GIT_DIR_KEY] = gitDir;
  GRANT_PATHS.forEach((path) => {
    const owner = path.slice(0, -1).reduce<Json>((node, key) => child(node, key), settings);
    const key = path[path.length - 1] ?? '';
    owner[key] = [...new Set([...stringList(owner[key]), gitDir])];
  });
  if (JSON.stringify(settings) === before) {
    return false;
  }
  writeFileAtomic(localSettingsPath(home), JSON.stringify(settings, null, 2) + '\n');
  return true;
};

/** A path git printed, in this platform's own form (Git for Windows prints `C:/…`). */
const gitPath = (path: string | null): string | null => (path ? resolve(path) : null);

const hasDotGit = (home: string): boolean => {
  try {
    lstatSync(join(home, '.git'));
    return true;
  } catch {
    return false;
  }
};

/** Where this folder's one-line `.git` link points, or null when `.git` is not such a link. */
const linkTarget = (home: string): string | null => {
  try {
    if (!lstatSync(join(home, '.git')).isFile()) {
      return null;
    }
    const target = /^gitdir:\s*(.+)$/m.exec(readFileSync(join(home, '.git'), 'utf-8'))?.[1]?.trim();
    return target ? resolve(home, target) : null;
  } catch {
    return null;
  }
};

/** Remove a `.git` link whose history folder is gone; a directory, a symlink, or a live link is never touched. */
const removeDeadLink = (home: string): void => {
  const target = linkTarget(home);
  if (target !== null && !existsSync(target)) {
    rmSync(join(home, '.git'));
  }
};

const STALE_LOCK_MS = 10 * 60 * 1000;

/**
 * A crash during the first snapshot leaves git's `index.lock` behind, and every retry then fails.
 * Before the first snapshot the index holds nothing worth protecting, so an old lock is cleared.
 */
const clearStaleLock = (gitDir: string): void => {
  const lock = join(gitDir, 'index.lock');
  try {
    if (Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS) {
      rmSync(lock, { force: true });
    }
  } catch {
    // no lock
  }
};

/** `git init` on the main line, without the `-b` flag git before 2.28 lacks. */
const initOnMain = (home: string, target: string | null): void => {
  git(home, ['init', '-q', ...(target ? ['--separate-git-dir', target] : [])]);
  git(home, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
};

/**
 * Re-stamp a history that followed its home to a new path, so a folder later created at the old path
 * can't claim it. Runs at session start; a history this feature didn't stamp is never touched.
 */
export const followMove = (home: string): void => {
  if (!hasDotGit(home)) {
    return;
  }
  const bound = tryGit(home, ['config', '--get', HOME_BINDING_KEY]);
  if (bound !== null && bound !== canonicalPath(home) && stampClaims(bound, home)) {
    git(home, ['config', HOME_BINDING_KEY, canonicalPath(home)]);
  }
};

/** Drop the recorded location, keeping every other setting. */
const forgetRecord = (home: string): void => {
  const settings = readSettings(home);
  const env = settings.env;
  if (isObject(env) && HOME_GIT_DIR_KEY in env) {
    delete env[HOME_GIT_DIR_KEY];
    writeFileAtomic(localSettingsPath(home), JSON.stringify(settings, null, 2) + '\n');
  }
};

/**
 * An unstamped history with no snapshot, no remote, and this home as its root: a setup that stopped
 * before stamping (or a bare `git init`). There is nothing in it to lose, so setup takes it over.
 */
const interruptedSetup = (home: string): boolean => {
  const top = gitPath(tryGit(home, ['rev-parse', '--show-toplevel']));
  return (
    top !== null &&
    canonicalPath(top) === canonicalPath(home) &&
    !gitSucceeds(home, ['rev-parse', '-q', '--verify', 'HEAD']) &&
    (tryGit(home, ['remote']) ?? '') === ''
  );
};

const homeSlug = (home: string): string =>
  basename(resolve(home))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent';

/**
 * First free spelling of a location: itself, then `-2`, `-3`… A history already stamped for this home
 * is its own spelling, so a home that lost both its link and its record gets its history back.
 */
const freePath = (candidate: string, home: string): string => {
  // Anything unreadable there (a file, no permission) counts as taken; never throw from here,
  // because SessionStart and the dashboard read this status too.
  const taken = (path: string): boolean => {
    try {
      return existsSync(path) && readdirSync(path).length > 0 && boundHome(path) !== canonicalPath(home);
    } catch {
      return true;
    }
  };
  const suffix = candidate.endsWith('.git') ? '.git' : '';
  const stem = candidate.slice(0, candidate.length - suffix.length);
  const spell = (attempt: number): string => {
    const path = attempt === 1 ? candidate : `${stem}-${attempt}${suffix}`;
    return taken(path) ? spell(attempt + 1) : path;
  };
  return spell(1);
};

/**
 * Where a synced home keeps its history: this plugin's folder in the per-user local state directory,
 * which no sync service touches (`%LOCALAPPDATA%` on Windows, the XDG `~/.local/state` elsewhere).
 */
const historyFolderFor = (home: string, historyEnv: HistoryEnv): string => {
  const stateRoot =
    process.platform === 'win32'
      ? (resolveEnv('LOCALAPPDATA') ?? join(historyEnv.userHome, 'AppData', 'Local'))
      : join(historyEnv.userHome, '.local', 'state');
  return freePath(
    join(stateRoot, runtimeDirName().replace(/^\./, ''), `${pathName(home, historyEnv.userHome)}.git`),
    home
  );
};

/**
 * The home's location as a folder name, so several homes never share one: its path under the user's
 * home (or its absolute path elsewhere) with separators as dashes, e.g. `Documents-Agents-Kevin`.
 */
const pathName = (home: string, userHome: string): string => {
  const real = canonicalPath(home);
  const base = canonicalPath(userHome);
  return (
    (isInside(real, base) ? relative(base, real) : real)
      .split(sep)
      .map((segment) => segment.replace(/:$/, ''))
      .filter(Boolean)
      .join('-')
      .replace(/[^A-Za-z0-9._-]+/g, '-') || 'home'
  );
};

const lastCommitOf = (home: string): LastCommit | null => {
  const line = tryGit(home, ['log', '-1', '--format=%h%x00%s%x00%cI']);
  if (!line) {
    return null;
  }
  const [hash = '', subject = '', date = ''] = line.split('\0');
  return { hash, subject, date };
};

const MESSAGES: Record<HistoryState, string> = {
  off: 'History is off.',
  on: 'History is on.',
  'pointer-missing': 'History is on, but the link from this folder to it went missing; setup restores it.',
  'history-missing':
    "The saved history this folder points to isn't available: it was deleted, it's on another computer, or it belongs to the folder this one was copied from.",
  'managed-by-you':
    'This folder already has version history set up some other way (by hand, copied from another folder, or as part of a larger project), so history leaves it alone.',
  'git-missing': 'Git, the tool that keeps the history, is not installed.'
};

/** Where this home's history stands, and what setup would offer. Read-only. */
export const historyStatus = (home: string, historyEnv: HistoryEnv = defaultEnv()): HistoryStatus => {
  const build = (state: HistoryState, extra: Partial<HistoryStatus> = {}): HistoryStatus => ({
    state,
    layout: null,
    gitDir: null,
    homeSyncedBy: null,
    historyFolder: null,
    lastCommit: null,
    message: MESSAGES[state],
    ...extra
  });

  const hint = gitInstallHint();
  if (hint) {
    return build('git-missing', { message: `${MESSAGES['git-missing']} Install it with: ${hint}` });
  }

  if (!hasDotGit(home)) {
    const recorded = recordedGitDir(home);
    if (recorded) {
      const where: Partial<HistoryStatus> = { layout: 'split', gitDir: recorded };
      return ownsHome(recorded, home) ? build('pointer-missing', where) : build('history-missing', where);
    }
    if (tryGit(home, ['rev-parse', '--show-toplevel']) !== null) {
      return build('managed-by-you');
    }
    const homeSyncedBy = historyEnv.syncedBy(home);
    return build('off', { homeSyncedBy, historyFolder: homeSyncedBy ? historyFolderFor(home, historyEnv) : null });
  }

  const link = linkTarget(home);
  if (link !== null && !existsSync(link)) {
    return build('history-missing', { layout: 'split', gitDir: link });
  }
  // Only a history this feature stamped (see `stampClaims`) is ours; git reads the stamp through any `.git`.
  const bound = tryGit(home, ['config', '--get', HOME_BINDING_KEY]);
  if (!stampClaims(bound, home) && !(bound === null && interruptedSetup(home))) {
    return build('managed-by-you');
  }
  const layout = historyInside(home) ? 'in-place' : 'split';
  // A home that started syncing after setup (iCloud "Desktop & Documents" turned on later) has its
  // history inside the synced folder; setup moves it out.
  const homeSyncedBy = layout === 'in-place' ? historyEnv.syncedBy(home) : null;
  return build('on', {
    layout,
    gitDir: layout === 'in-place' ? join(home, '.git') : gitPath(tryGit(home, ['rev-parse', '--absolute-git-dir'])),
    lastCommit: lastCommitOf(home),
    homeSyncedBy,
    historyFolder: homeSyncedBy ? historyFolderFor(home, historyEnv) : null
  });
};

const ensureIdentity = (home: string, name: string | undefined): void => {
  if (!tryGit(home, ['config', 'user.name'])) {
    git(home, ['config', '--local', 'user.name', name?.trim() || userInfo().username]);
  }
  if (!tryGit(home, ['config', 'user.email'])) {
    git(home, ['config', '--local', 'user.email', `${homeSlug(home)}@localhost`]);
  }
};

/**
 * Paths that must never enter history but would: the secrets folder and local settings stay out
 * whatever the operator's .gitignore negations say. Their contents are never read.
 */
const exposedPrivatePaths = (home: string): string[] => {
  const store = `${runtimeDirName()}/secrets/`;
  const untracked = gitRaw(home, ['ls-files', '-z', '--others', '--exclude-standard'])
    .split('\0')
    .filter((path) => path.startsWith(store));
  const unignored = [`${store}.env`, '.claude/settings.local.json'].filter(
    (path) => !gitSucceeds(home, ['check-ignore', '-q', path])
  );
  return [...new Set([...untracked, ...unignored])];
};

/**
 * Turn history on: create it (in place, or in a local folder when the home is synced), stamp it for
 * this home, record a split location with its grants, and make the first snapshot. Idempotent: a
 * re-run only fills what is missing.
 */
export const setupHistory = (
  home: string,
  options: SetupOptions = {},
  historyEnv: HistoryEnv = defaultEnv()
): SetupResult => {
  const result = (outcome: SetupOutcome, message: string, extra: Partial<SetupResult> = {}): SetupResult => ({
    outcome,
    status: extra.status ?? historyStatus(home, historyEnv),
    settingsChanged: false,
    message,
    ...extra
  });

  // Read by the catch too: a failure after the grants were written must still report them.
  let settingsChanged = false;
  try {
    restorePointer(home);
    if (options.startOver === true && historyStatus(home, historyEnv).state === 'history-missing') {
      removeDeadLink(home);
      forgetRecord(home);
    }
    const status = historyStatus(home, historyEnv);
    if (status.state !== 'off' && status.state !== 'on') {
      return result('refused', status.message, { status });
    }
    const target = status.historyFolder;
    if (target && historyEnv.syncedBy(target) !== null) {
      return result('refused', `${target} is in a synced folder too; history must stay on this computer.`, { status });
    }
    if (target) {
      mkdirSync(dirname(target), { recursive: true });
    }
    // Off: create it. On, but kept inside a folder that now syncs: git moves the existing history out.
    const moved = status.state === 'on' && target !== null;
    if (status.state === 'off') {
      initOnMain(home, target);
    } else if (moved) {
      git(home, ['init', '-q', '--separate-git-dir', target]);
    }
    // Stamp a new history, finish an interrupted one, and follow a home that was renamed or moved.
    if (tryGit(home, ['config', '--get', HOME_BINDING_KEY]) !== canonicalPath(home)) {
      git(home, ['config', HOME_BINDING_KEY, canonicalPath(home)]);
    }

    const current = historyStatus(home, historyEnv);
    if (current.layout === 'split' && current.gitDir) {
      settingsChanged = recordLocation(home, current.gitDir);
    }
    if (current.lastCommit) {
      const outcome = moved ? 'moved' : 'already-on';
      return result(outcome, `History is on, kept in ${current.gitDir}.`, { status: current, settingsChanged });
    }

    ensureIdentity(home, options.name);
    reconcileHomeGitignore(home, join(FOLDERS.TEMPLATES, '.gitignore'), true, runtimeDirName());
    const exposed = exposedPrivatePaths(home);
    if (exposed.length > 0) {
      return result(
        'refused',
        `These private files would enter history, because this folder's .gitignore lets them in: ${exposed.join(', ')}.`,
        { settingsChanged }
      );
    }
    if (current.gitDir) {
      clearStaleLock(current.gitDir);
    }
    git(home, ['add', '-A']);
    if (!gitSucceeds(home, ['diff', '--cached', '--quiet'])) {
      git(home, ['commit', '-q', '-F', '-'], FIRST_COMMIT_MESSAGE);
    }
    git(home, ['fsck', '--full', '--no-progress']);
    log.info(`setup turned-on (${current.gitDir})`);
    return result('turned-on', `History is on, kept in ${current.gitDir}.`, { settingsChanged });
  } catch (err) {
    log.error('setup failed', err);
    return result('failed', errorText(err), { settingsChanged });
  }
};

/**
 * Put back the `.git` link a synced folder deleted. Its content is fully determined by the recorded
 * location, and only a history stamped for this home qualifies (a copied home carries the record
 * too), so it is safe to write unattended. Returns whether it wrote the link.
 */
export const restorePointer = (home: string): boolean => {
  const gitDir = recordedGitDir(home);
  if (!gitDir || !ownsHome(gitDir, home)) {
    return false;
  }
  // Exclusive create: an existing entry, even a dangling symlink, is left alone and never followed.
  try {
    // Forward slashes on every platform, the way git writes this file itself.
    writeFileSync(join(home, '.git'), `gitdir: ${gitDir.split(sep).join('/')}\n`, { flag: 'wx' });
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'EEXIST') {
      return false;
    }
    throw err;
  }
  log.warn(`restored the missing .git pointer to ${gitDir} at ${new Date().toISOString()}`);
  return true;
};
