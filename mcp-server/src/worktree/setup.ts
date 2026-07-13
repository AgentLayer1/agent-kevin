/**
 * Worktree lifecycle — the shared implementation behind the `setup_worktree` /
 * `remove_worktree` MCP tools and the `kevin worktree` CLI command.
 *
 * `setupWorktree` creates a sibling git worktree, copies the gitignored local files a fresh
 * checkout lacks (`.env*`, `.claude/settings.local.json`, `.cmux`, root `.cursor`/`.cursorignore`),
 * detects the package manager, installs, and runs the first build script it finds.
 * Read-only against the source checkout — it copies, never deletes or overwrites there.
 *
 * `removeWorktree` tears one down safely: it refuses outright on uncommitted changes, gates
 * committed-but-unpushed removal behind an explicit `force`, runs the repo's `clean` script when
 * present, then `git worktree remove`s it. The branch is left alone unless `deleteBranch` is set.
 * It never passes `--force` — a git refusal (dirty/locked) fails loud. On native Windows it first
 * kills any process tree still rooted in the worktree (a lingering dev server locks the dir, so clean
 * and `git worktree remove` would otherwise fail — see releaseHolders), and once git has deregistered
 * the worktree, clears the pnpm-junction husk git leaves behind (see deleteHusk). Orphan sweep across
 * stale worktrees is still out of scope.
 *
 * Runs git/package-manager via execFileSync (argv arrays, no shell). When invoked through
 * the MCP server this executes OUTSIDE the Bash command sandbox, so `git worktree add` can
 * write the main repo's `.git/config` and the checked-out config files (`.vscode/settings.json`,
 * `.mcp.json`) that the seatbelt denies under the Bash tool. Invoked via the CLI from a
 * sandboxed Bash, those same writes are still blocked — the CLI is the terminal/automation path.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

/** Build artifacts and VCS internals — never scanned or copied. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo']);
/** Local config dirs copied whole wherever they appear in the tree (root or per-package). */
const LOCAL_DIR_NAMES = new Set(['.cmux']);
/** Local config files/dirs copied when present at the repo root only. */
const LOCAL_PATHS = ['.cursor', '.cursorignore'];
/** Lockfile → package manager. First match wins, so order by specificity. */
const LOCKFILES = [
  { file: 'bun.lock', pm: 'bun' },
  { file: 'bun.lockb', pm: 'bun' },
  { file: 'pnpm-lock.yaml', pm: 'pnpm' },
  { file: 'yarn.lock', pm: 'yarn' },
  { file: 'package-lock.json', pm: 'npm' }
] as const;
/** Build scripts to look for in package.json, in preference order — full `build` first. */
const BUILD_SCRIPTS = ['build', 'build:packages', 'build:libs'];

/** Base branches to start a NEW worktree branch from, in preference order. Falls back to current HEAD. */
const BASE_BRANCH_PREFERENCE = ['dev', 'develop', 'main', 'master'];

/** These strings become git / path arguments — keep them to safe charsets. */
const BRANCH_RE = /^[A-Za-z0-9._/-]+$/;
const SLUG_RE = /^[A-Za-z0-9._-]+$/;

interface PackageJson {
  packageManager?: string;
  scripts?: Record<string, string>;
}

export interface StepResult {
  step: string;
  ok: boolean;
  output: string;
}

export interface SetupWorktreeOptions {
  /** Absolute path to the MAIN checkout of the repo the worktree is for. */
  repoPath: string;
  /** Branch name; created with -b, or checked out if it already exists. Always namespaced under the
   *  operator (e.g. `basem/<name>`) unless it's already under that namespace. */
  branch: string;
  /** Explicit branch/ref to start the new branch from. Overrides the dev→develop→main→master→HEAD
   *  auto-detection. Must resolve in the repo. Ignored when the target branch already exists. */
  baseBranch?: string;
  /** Folder suffix for the worktree dir (<repo>-<slug>); defaults to the branch's last segment. */
  slug?: string;
  /** Relative subdirs with their own lockfile to install after the main bootstrap. */
  extraInstalls?: string[];
}

export interface SetupWorktreeResult {
  worktreePath: string;
  branch: string;
  branchExists: boolean;
  /** The branch the new worktree branched from (resolved base, or current HEAD on fallback). */
  baseBranch: string;
  sourceCheckout: string;
  copied: string[];
  packageManager: string | null;
  built: boolean;
  extraInstalled: string[];
  steps: StepResult[];
}

/** True for env files to carry over: `.env` and any `.env.*` (including `.env.example`). */
const isEnvFile = (fileName: string) => fileName === '.env' || fileName.startsWith('.env.');

/** Local config files copied wherever they appear, matched by (parent dir, file name). */
const isLocalConfigFile = (parentDir: string, fileName: string) =>
  isEnvFile(fileName) || (fileName === 'settings.local.json' && basename(parentDir) === '.claude');

/** Run git with argv (no shell), capturing trimmed stdout; throws on non-zero. */
const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** True if `ref` resolves to any object (branch, tag, remote ref, SHA) in the repo at `cwd`. */
const refExists = (cwd: string, ref: string): boolean => {
  try {
    git(cwd, ['rev-parse', '--verify', '--quiet', ref]);
    return true;
  } catch {
    return false;
  }
};

/** True if `name` exists as a local branch in the repo at `cwd`. */
const localBranchExists = (cwd: string, name: string): boolean => refExists(cwd, `refs/heads/${name}`);

/** Sanitise a token to the branch-namespace charset (lowercase, `[a-z0-9._-]`). */
const sanitizeNamespace = (raw: string) =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');

/**
 * The operator's branch namespace (lowercased), derived from git identity. Tries the first token of
 * `user.name` first — an email local-part can be `first.last`, which makes a worse folder than a
 * bare first name — then falls back to the email local-part. Null if neither is configured.
 */
const branchNamespace = (cwd: string): string | null => {
  const tryGit = (args: string[]): string => {
    try {
      return git(cwd, args);
    } catch {
      return '';
    }
  };
  const fromName = sanitizeNamespace(tryGit(['config', 'user.name']).split(/\s+/)[0] ?? '');
  if (fromName) {
    return fromName;
  }
  const email = tryGit(['config', 'user.email']);
  const fromEmail = email.includes('@') ? sanitizeNamespace(email.split('@')[0] ?? '') : '';
  return fromEmail || null;
};

/**
 * Run a package-manager command, capturing output. NEVER inherit stdio — under the MCP server
 * this process's stdout is the stdio transport, so child output on it would corrupt the protocol.
 */
const runCapture = (command: string, args: string[], cwd: string): { ok: boolean; output: string } => {
  try {
    const output = execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    });
    return { ok: true, output };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    const output = [failure.stdout, failure.stderr].filter(Boolean).join('\n') || failure.message || String(error);
    return { ok: false, output };
  }
};

const tail = (text: string, lines = 20) => text.split('\n').slice(-lines).join('\n');

/**
 * Recursively collect local files/dirs to carry over (config files + LOCAL_DIR_NAMES), as paths
 * relative to `root`. A matched directory is taken whole — we don't descend into it.
 */
const findLocalEntries = (dir: string, root: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (LOCAL_DIR_NAMES.has(entry.name)) {
        return [relative(root, fullPath)];
      }
      return SKIP_DIRS.has(entry.name) ? [] : findLocalEntries(fullPath, root);
    }
    return isLocalConfigFile(dir, entry.name) ? [relative(root, fullPath)] : [];
  });

const readPkg = (root: string): PackageJson =>
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageJson;

/** Detect the target repo's package manager: packageManager field → lockfile → bun. */
const detectPackageManager = (root: string, pkg: PackageJson) => {
  const declared = pkg.packageManager?.split('@')[0]?.trim();
  if (declared) {
    return declared;
  }
  const match = LOCKFILES.find(({ file }) => existsSync(join(root, file)));
  return match?.pm ?? 'bun';
};

/** Install (and optionally build) a directory that has a package.json. */
const installAndBuild = (
  dir: string,
  withBuild: boolean
): { packageManager: string; built: boolean; steps: StepResult[] } => {
  const pkg = readPkg(dir);
  const packageManager = detectPackageManager(dir, pkg);
  const steps: StepResult[] = [];

  const install = runCapture(packageManager, ['install'], dir);
  steps.push({ step: `${packageManager} install`, ok: install.ok, output: tail(install.output) });

  let built = false;
  if (install.ok && withBuild) {
    const buildScript = BUILD_SCRIPTS.find((name) => pkg.scripts?.[name]);
    if (buildScript) {
      const build = runCapture(packageManager, ['run', buildScript], dir);
      built = build.ok;
      steps.push({ step: `${packageManager} run ${buildScript}`, ok: build.ok, output: tail(build.output) });
    }
  }
  return { packageManager, built, steps };
};

export const setupWorktree = ({
  repoPath,
  branch,
  baseBranch: baseBranchOverride,
  slug,
  extraInstalls
}: SetupWorktreeOptions): SetupWorktreeResult => {
  if (!BRANCH_RE.test(branch)) {
    throw new Error(`Invalid branch name: ${branch}`);
  }
  const resolvedRepo = resolve(repoPath);
  if (!existsSync(resolvedRepo) || !statSync(resolvedRepo).isDirectory()) {
    throw new Error(`repoPath does not exist or is not a directory: ${resolvedRepo}`);
  }

  // Main checkout = first `worktree` entry of the porcelain list. That's both the copy
  // source (it holds the gitignored locals) and the parent for the sibling worktree path.
  const listing = git(resolvedRepo, ['worktree', 'list', '--porcelain']);
  const firstLine = listing.split('\n').find((line) => line.startsWith('worktree '));
  if (!firstLine) {
    throw new Error(`Not a git repository (no worktree list): ${resolvedRepo}`);
  }
  const mainCheckout = resolve(firstLine.slice('worktree '.length).trim());

  // Branch-folder convention: the operator's name is ALWAYS the top folder (e.g. basem/<name>),
  // derived from git identity. Kept verbatim only if it's already under that namespace (avoids
  // basem/basem/...) — so a type-prefixed name like `feat/x` still nests to `basem/feat/x` rather
  // than escaping the operator folder. With no identity configured, fall back to the bare name.
  const namespace = branchNamespace(mainCheckout);
  const finalBranch =
    !namespace || branch === namespace || branch.startsWith(`${namespace}/`) ? branch : `${namespace}/${branch}`;

  const featureSlug = slug ?? finalBranch.split('/').pop() ?? finalBranch;
  if (!SLUG_RE.test(featureSlug)) {
    throw new Error(`Invalid slug: ${featureSlug}`);
  }
  const worktreePath = join(dirname(mainCheckout), `${basename(mainCheckout)}-${featureSlug}`);
  if (existsSync(worktreePath)) {
    throw new Error(`Worktree path already exists: ${worktreePath}`);
  }

  const branchExists = localBranchExists(mainCheckout, finalBranch);

  // Start-point for a NEW branch: explicit override (must resolve) → first available base in
  // preference order → the main checkout's current branch (HEAD). An existing branch is checked
  // out as-is (it's its own base).
  const resolveBase = (): string => {
    if (baseBranchOverride) {
      if (!BRANCH_RE.test(baseBranchOverride)) {
        throw new Error(`Invalid baseBranch: ${baseBranchOverride}`);
      }
      if (!refExists(mainCheckout, baseBranchOverride)) {
        throw new Error(`baseBranch does not exist in the repo: ${baseBranchOverride}`);
      }
      return baseBranchOverride;
    }
    return (
      BASE_BRANCH_PREFERENCE.find((name) => localBranchExists(mainCheckout, name)) ??
      git(mainCheckout, ['rev-parse', '--abbrev-ref', 'HEAD'])
    );
  };
  const baseBranch = branchExists ? finalBranch : resolveBase();

  git(
    mainCheckout,
    branchExists
      ? ['worktree', 'add', worktreePath, finalBranch]
      : ['worktree', 'add', worktreePath, '-b', finalBranch, baseBranch]
  );

  // Copy gitignored locals from the main checkout — copy only, never delete/overwrite there.
  const copied = [
    ...new Set([
      ...findLocalEntries(mainCheckout, mainCheckout),
      ...LOCAL_PATHS.filter((path) => existsSync(join(mainCheckout, path)))
    ])
  ];
  copied.forEach((rel) => {
    const target = join(worktreePath, rel);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(mainCheckout, rel), target, { recursive: true });
  });

  const steps: StepResult[] = [];
  let packageManager: string | null = null;
  let built = false;

  if (existsSync(join(worktreePath, 'package.json'))) {
    const result = installAndBuild(worktreePath, true);
    packageManager = result.packageManager;
    built = result.built;
    steps.push(...result.steps);
  }

  const extraInstalled: string[] = [];
  for (const sub of extraInstalls ?? []) {
    if (isAbsolute(sub) || sub.split(/[/\\]/).includes('..')) {
      throw new Error(`extraInstalls entries must be relative paths without "..": ${sub}`);
    }
    const subDir = join(worktreePath, sub);
    if (!existsSync(join(subDir, 'package.json'))) {
      steps.push({ step: `extra:${sub}`, ok: false, output: 'no package.json — skipped' });
      continue;
    }
    const result = installAndBuild(subDir, false);
    steps.push(...result.steps.map((entry) => ({ ...entry, step: `extra:${sub} ${entry.step}` })));
    if (result.steps.every((entry) => entry.ok)) {
      extraInstalled.push(sub);
    }
  }

  return {
    worktreePath,
    branch: finalBranch,
    branchExists,
    baseBranch,
    sourceCheckout: mainCheckout,
    copied,
    packageManager,
    built,
    extraInstalled,
    steps
  };
};

export interface RemoveWorktreeOptions {
  /** Absolute path to the worktree to remove. Must be a registered worktree, never the main checkout. */
  worktreePath: string;
  /** Also delete the worktree's branch after removal. Off by default — the branch survives unless asked. */
  deleteBranch?: boolean;
  /** Proceed when the branch has committed-but-unpushed work. Never overrides uncommitted changes. */
  force?: boolean;
  /** Report what would happen (the `status`) WITHOUT cleaning or removing anything. The pre-check the
   *  skill runs to decide whether to unwire the VS Code workspace before committing to the removal. */
  dryRun?: boolean;
}

/**
 * `removable` is the dry-run all-clear (gates pass, nothing touched); `removed` is the real success;
 * `failed` means git refused the removal (dirty/locked) or a leftover couldn't be deleted — nothing
 * was force-removed. The `blocked-*` states report a refusal the caller must resolve first.
 */
export type RemoveWorktreeStatus = 'removed' | 'removable' | 'failed' | 'blocked-uncommitted' | 'blocked-unpushed';

export interface RemoveWorktreeResult {
  worktreePath: string;
  /** The worktree's branch, or null when detached (nothing to delete). */
  branch: string | null;
  mainCheckout: string;
  status: RemoveWorktreeStatus;
  removed: boolean;
  branchDeleted: boolean;
  /** Porcelain status lines when blocked on uncommitted changes; empty otherwise. */
  uncommitted: string[];
  /** Commits reachable from HEAD but on no remote — the unpushed count. */
  unpushed: number;
  /** The clean script that ran (e.g. `pnpm run clean`), or null when none was present. */
  cleaned: string | null;
  branchDeleteError?: string;
  steps: StepResult[];
}

/** Count commits reachable from HEAD that no remote-tracking branch has — the unpushed work. */
const unpushedCount = (cwd: string): number => {
  try {
    return Number(git(cwd, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])) || 0;
  } catch {
    return 0;
  }
};

/**
 * Filesystem-path equality that survives platform quirks: git emits `/` in `worktree list` while
 * Node emits `\` on Windows, and Windows paths are case-insensitive. On Unix this is plain `===`.
 */
const samePath = (first: string, second: string): boolean => {
  const norm = (path: string) => (process.platform === 'win32' ? path.replace(/\\/g, '/').toLowerCase() : path);
  return norm(first) === norm(second);
};

/**
 * Terminate any process still rooted in the worktree before tearing it down. On native Windows a
 * leftover dev server (`pnpm dev` / turbo, an esbuild service, a file watcher) keeps the directory
 * locked, so `pnpm clean` and `git worktree remove` fail with EPERM/EBUSY and strand a husk. A
 * process launched from the worktree carries that absolute path in its command line, so match on it
 * and kill each process tree (`taskkill /T`). Scoped to the worktree's unique path — never a blanket
 * kill. No-op on Unix, which frees a directory even while a process sits inside it. Runs from the main
 * checkout so it never opens a fresh handle on the directory it's clearing.
 */
const releaseHolders = (worktreePath: string, cwd: string): StepResult => {
  if (process.platform !== 'win32') {
    return { step: 'release holders', ok: true, output: 'skipped (not windows)' };
  }
  const path = worktreePath.replace(/\//g, '\\').toLowerCase().replace(/'/g, "''");
  const script = [
    `$holders = Get-CimInstance Win32_Process |`,
    `  Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.ToLower().Contains('${path}') }`,
    `foreach ($h in $holders) { taskkill /F /T /PID $h.ProcessId | Out-Null }`,
    `if ($holders) { "killed $($holders.Count)" } else { 'no holders found' }`
  ].join('\n');
  // execFileSync directly (no shell) so the script's pipes and braces reach PowerShell intact —
  // routing through a Windows shell would let cmd.exe interpret them.
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { cwd, encoding: 'utf8' });
    return { step: 'release holders', ok: true, output: tail(out.trim()) };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    const output = [failure.stdout, failure.stderr, failure.message].filter(Boolean).join('\n');
    return { step: 'release holders', ok: false, output: tail(output) };
  }
};

/**
 * Delete a leftover worktree dir on native Windows, where `git worktree remove` can't traverse
 * pnpm's `node_modules` junctions (it errors "Directory not empty" and leaves a husk). `rmdir /s /q`
 * clears the reparse points cmd-side — a single quoted `/c` string (shell:false) keeps paths with
 * spaces intact — and `fs.rmSync` is the fallback that names the blocker (e.g. a locked file).
 * TODO(windows): unverified on a real box — see lo-045.
 */
const deleteHusk = (dir: string): StepResult[] => {
  const steps: StepResult[] = [];
  try {
    execFileSync('cmd', ['/c', `rmdir /s /q "${dir}"`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    steps.push({ step: `rmdir /s /q ${basename(dir)}`, ok: !existsSync(dir), output: '' });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    const output = [failure.stdout, failure.stderr, failure.message].filter(Boolean).join('\n');
    steps.push({ step: `rmdir /s /q ${basename(dir)}`, ok: false, output: tail(output) });
  }
  if (!existsSync(dir)) {
    return steps;
  }
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
    steps.push({
      step: `fs.rmSync ${basename(dir)}`,
      ok: !existsSync(dir),
      output: existsSync(dir) ? 'still present' : ''
    });
  } catch (error) {
    steps.push({ step: `fs.rmSync ${basename(dir)}`, ok: false, output: (error as Error).message });
  }
  return steps;
};

export const removeWorktree = ({
  worktreePath,
  deleteBranch,
  force,
  dryRun
}: RemoveWorktreeOptions): RemoveWorktreeResult => {
  const resolvedInput = resolve(worktreePath);
  if (!existsSync(resolvedInput) || !statSync(resolvedInput).isDirectory()) {
    throw new Error(`worktreePath does not exist or is not a directory: ${resolvedInput}`);
  }
  // git reports realpath-canonical worktree paths, so canonicalize the input too before comparing —
  // otherwise a symlinked checkout dir (macOS /tmp, /var) never matches the registered entry.
  const resolvedWorktree = realpathSync(resolvedInput);

  // Enumerate registered worktrees from the target itself. The first entry is the main checkout —
  // the safe cwd to run the removal from, and a path we must refuse to remove.
  const entries = git(resolvedWorktree, ['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim());
  const mainCheckout = entries[0];
  if (!mainCheckout) {
    throw new Error(`Not a git repository (no worktree list): ${resolvedWorktree}`);
  }
  if (samePath(resolvedWorktree, mainCheckout)) {
    throw new Error(`Refusing to remove the main checkout: ${resolvedWorktree}`);
  }
  if (!entries.some((entry) => samePath(entry, resolvedWorktree))) {
    throw new Error(`Not a registered worktree of this repo: ${resolvedWorktree}`);
  }

  const head = git(resolvedWorktree, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = head === 'HEAD' ? null : head;

  const uncommitted = git(resolvedWorktree, ['status', '--porcelain']).split('\n').filter(Boolean);
  const unpushed = unpushedCount(resolvedWorktree);
  const base = { worktreePath: resolvedWorktree, branch, mainCheckout, branchDeleted: false, uncommitted, unpushed };

  // Uncommitted work is a hard stop — `force` never overrides it.
  if (uncommitted.length > 0) {
    return { ...base, status: 'blocked-uncommitted', removed: false, cleaned: null, steps: [] };
  }
  // Committed-but-unpushed work needs an explicit go-ahead.
  if (unpushed > 0 && !force) {
    return { ...base, status: 'blocked-unpushed', removed: false, cleaned: null, steps: [] };
  }
  // Gates pass. In dry-run, stop here — the caller unwires the VS Code workspace, then re-calls for real.
  if (dryRun) {
    return { ...base, status: 'removable', removed: false, cleaned: null, steps: [] };
  }

  const steps: StepResult[] = [];

  // Kill any process tree still rooted in the worktree first (win32-only, no-op elsewhere). A lingering
  // dev server locks the dir, so both the clean step below and `git worktree remove` would fail.
  steps.push(releaseHolders(resolvedWorktree, mainCheckout));

  // Run the repo's own teardown (`pnpm clean` et al.) before the checkout disappears.
  let cleaned: string | null = null;
  if (existsSync(join(resolvedWorktree, 'package.json'))) {
    const pkg = readPkg(resolvedWorktree);
    if (pkg.scripts?.clean) {
      const packageManager = detectPackageManager(resolvedWorktree, pkg);
      const result = runCapture(packageManager, ['run', 'clean'], resolvedWorktree);
      cleaned = `${packageManager} run clean`;
      steps.push({ step: cleaned, ok: result.ok, output: tail(result.output) });
    }
  }

  // No `--force`, ever: let git apply its own dirty/lock safety check. Careful-and-failing beats an
  // incorrect forced delete.
  const removal = runCapture('git', ['worktree', 'remove', resolvedWorktree], mainCheckout);
  steps.push({ step: 'git worktree remove', ok: removal.ok, output: tail(removal.output) });

  // Whether git DEREGISTERED the worktree — not the exit code — is the real "git approved this"
  // signal (on Windows it can leave the dir as a husk yet still deregister). If it's still listed,
  // git refused (dirty/locked): fail loud, force-delete nothing.
  const stillRegistered = git(mainCheckout, ['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .some((line) => samePath(line.slice('worktree '.length).trim(), resolvedWorktree));
  if (stillRegistered) {
    return { ...base, status: 'failed', removed: false, cleaned, steps };
  }

  // git approved and deregistered it. On native Windows a filesystem husk of pnpm node_modules
  // junctions can linger — a git-approved leftover (unreachable on a refusal above), safe to clear.
  if (process.platform === 'win32' && existsSync(resolvedWorktree)) {
    steps.push(...deleteHusk(resolvedWorktree));
  }
  if (existsSync(resolvedWorktree)) {
    return { ...base, status: 'failed', removed: false, cleaned, steps };
  }

  let branchDeleted = false;
  let branchDeleteError: string | undefined;
  if (deleteBranch && branch) {
    const deletion = runCapture('git', ['branch', force ? '-D' : '-d', branch], mainCheckout);
    branchDeleted = deletion.ok;
    steps.push({ step: `git branch ${force ? '-D' : '-d'} ${branch}`, ok: deletion.ok, output: tail(deletion.output) });
    if (!deletion.ok) {
      branchDeleteError = deletion.output.trim();
    }
  }

  return { ...base, status: 'removed', removed: true, branchDeleted, cleaned, steps, branchDeleteError };
};
