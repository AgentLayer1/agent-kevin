import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { commandWords, scanShell, type ShellCommand } from './shell-scan';

/** One platform's path rules, with the home and the starting cwd already in that platform's form. */
interface Paths {
  api: typeof posix;
  native: (path: string) => string;
  home: string;
  realHome: string;
  start: string;
}

/** Git Bash and Cygwin spell C:\Users as /c/Users or /cygdrive/c/Users; Windows path APIs need the drive form. */
const driveForm = (path: string): string => path.replace(/^\/(?:cygdrive\/)?([a-z])(?=\/|$)/i, '$1:/');

/** The target of a symlinked spelling (/tmp for /private/tmp); a path that doesn't exist stays as written. */
const physical = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

const pathsFor = (cwd: string, home: string, platform: NodeJS.Platform): Paths => {
  const api = platform === 'win32' ? win32 : posix;
  const native = platform === 'win32' ? driveForm : (path: string) => path;
  const resolvedHome = api.resolve(native(home));
  return { api, native, home: resolvedHome, realHome: physical(resolvedHome), start: api.resolve(native(cwd)) };
};

const within = (root: string, dir: string, api: typeof posix): boolean => {
  const fromRoot = api.relative(root, dir);
  return fromRoot !== '..' && !fromRoot.startsWith(`..${api.sep}`) && !api.isAbsolute(fromRoot);
};

const insideHome = (dir: string, { api, home, realHome }: Paths): boolean =>
  within(home, dir, api) || within(realHome, physical(dir), api);

const COMPUTED_DIR = /[$`*?[]|^~/;
const HOME_PREFIX = /^(?:~|\$HOME|\$\{HOME\})(?=$|\/)/;

/** Where a shell stands after `command`; undefined once a cd target is one the shell computes. */
const resolveCd = (dir: string | undefined, command: ShellCommand, { api, native }: Paths): string | undefined => {
  const [name, ...args] = commandWords(command);
  if (name?.text !== 'cd' && name?.text !== 'pushd' && name?.text !== 'popd') {
    return dir;
  }
  const target = args.find((word) => word.text === '-' || !word.text.startsWith('-'));
  if (name.text === 'popd' || (name.text === 'pushd' && !target)) {
    return undefined;
  }
  const raw = (target?.text ?? '~').replace(HOME_PREFIX, homedir());
  if (raw === '-' || COMPUTED_DIR.test(raw)) {
    return undefined;
  }
  const path = native(raw);
  return api.isAbsolute(path) ? api.resolve(path) : dir && api.resolve(dir, path);
};

interface Step {
  command: ShellCommand;
  dir: string | undefined;
}

/**
 * Each command with the directory it runs in, and where the session's shell ends up. A subshell
 * starts where its parent stands and its cd stays inside it. A cd target the shell computes leaves
 * that shell's directory unknown, and unknown means allow.
 */
const walk = (commands: ShellCommand[], paths: Paths): { steps: Step[]; end: string | undefined } => {
  const dirs = new Map<number, string | undefined>([[0, paths.start]]);
  const steps: Step[] = [];
  for (const command of commands) {
    const dir = command.shells.reduce<string | undefined>((parent, shell) => {
      if (!dirs.has(shell)) {
        dirs.set(shell, parent);
      }
      return dirs.get(shell);
    }, paths.start);
    steps.push({ command, dir });
    dirs.set(command.shells.at(-1) ?? 0, resolveCd(dir, command, paths));
  }
  return { steps, end: dirs.get(0) };
};

const HOME_TREES = ['knowledge', 'projects', 'reports'];
const TREE_PATH = new RegExp(`^(?:\\./)?(${HOME_TREES.join('|')})/`);
const OUTPUT_REDIRECT = /^(?:\d*>[>|]?|&>>?)$/;
/** What each writing command writes: every operand, or only the last (its destination). */
const WRITES = new Map<string, 'all' | 'last'>([
  ['mkdir', 'all'],
  ['touch', 'all'],
  ['tee', 'all'],
  ['cp', 'last'],
  ['mv', 'last'],
  ['install', 'last'],
  ['rsync', 'last'],
  ['ln', 'last']
]);

/** The paths a command writes. Only a write can misplace a file; a read from the wrong cwd merely fails. */
const writeTargets = (command: ShellCommand): string[] => {
  const [name, ...args] = commandWords(command);
  const operands = args.filter(
    (word, index) => !word.operator && !args[index - 1]?.operator && !word.text.startsWith('-')
  );
  const mode = WRITES.get(name?.text ?? '');
  const named = mode === 'all' ? operands : mode === 'last' ? operands.slice(-1) : [];
  const redirected = command.words.filter((_, index) => {
    const before = command.words[index - 1];
    return before?.operator === true && OUTPUT_REDIRECT.test(before.text);
  });
  return [...redirected, ...named].map((word) => word.text);
};

/**
 * The first home-relative path a command writes from outside the agent home. A tree that really
 * exists under that cwd (a repo with its own `projects/`) is that repo's, not a leak.
 */
const leakIn = (steps: Step[], paths: Paths): string | undefined =>
  steps
    .flatMap(({ command, dir }) =>
      dir && !insideHome(dir, paths) ? writeTargets(command).map((path) => ({ path, dir })) : []
    )
    .find(({ path, dir }) => {
      const tree = TREE_PATH.exec(path)?.[1];
      return tree !== undefined && !existsSync(paths.api.resolve(dir, tree));
    })?.path;

/** Kept for the leak rule's own tests; the hook goes through `shellGuard`. */
export function homeRelativeLeak(
  command: string,
  cwd: string,
  home: string,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  const paths = pathsFor(cwd, home, platform);
  return leakIn(walk(scanShell(command), paths).steps, paths);
}

const TMPDIR_VAR = String.raw`\$(?:TMPDIR\b|\{TMPDIR(?:[:=?+-][^}]*)?\})`;
/** A path under the shared temp dir, after an optional `name=`: group 1 is the `$TMPDIR` spelling when used, group 2 the folder right under it. */
const TEMP_PATH = new RegExp(
  String.raw`^(?:[\w-]+=)?(?:(${TMPDIR_VAR})|/(?:private/)?tmp(?:/claude-\d+)?|/var/folders/[^/]+/[^/]+/T)/([^/]*)`
);
const SCRATCH_FIX =
  'Make scratch with mktemp "${TMPDIR:-/tmp}/<prefix>-XXXXXX" (or mktemp -d) and use the exact path it prints.';

/**
 * Why a command misuses the shared temp dir, or undefined. `$TMPDIR` is one folder for every
 * session on the machine, so a pattern in the folder name right under it can pick another
 * session's scratch, and a name written by hand can be written by another session at the same time.
 */
const scratchProblem = (command: ShellCommand): string | undefined => {
  const temp = command.words.flatMap((word) => {
    const match = TEMP_PATH.exec(word.text);
    return match && (match[1] === undefined || word.expands)
      ? [{ word, variable: match[1], folder: match[2] ?? '' }]
      : [];
  });
  const pattern = temp.find(({ word, folder }) => word.globbed && /[*?[]/.test(folder));
  if (pattern) {
    return `Blocked: ${pattern.word.text} finds scratch by pattern in the shared temp dir, which every session on this machine writes to, so it can match another session's files. ${SCRATCH_FIX}`;
  }
  if (commandWords(command)[0]?.text === 'mktemp') {
    return undefined;
  }
  const picked = temp.find(({ variable, folder }) => variable && folder);
  return (
    picked &&
    `Blocked: ${picked.variable}/${picked.folder} is a hand-picked name in the shared temp dir, which another session can write at the same moment. ${SCRATCH_FIX}`
  );
};

/**
 * The block message when a command leaves the session's shell outside the agent home. Under Claude
 * Code a cd in one call carries over to every later call, so a session that already drifted (an
 * operator `!` cd, a computed cd) is refused until a command returns.
 */
const driftMessage = (end: string | undefined, paths: Paths): string | undefined => {
  if (end === undefined || insideHome(end, paths)) {
    return undefined;
  }
  if (end === paths.start) {
    return (
      `Blocked: the session's working directory is ${paths.start}, outside the agent home ${paths.home}, because an earlier cd moved it. ` +
      `Run cd "${paths.home.replaceAll('\\', '/')}" first (alone, or as this command's start), then name other repos with git -C <repo> and absolute paths.`
    );
  }
  return (
    `Blocked: this command would leave the session's working directory at ${end}, outside the agent home ${paths.home}, ` +
    `and a cd carries over to every later command. Name the repo instead (git -C <repo>, absolute paths), or keep the cd in a subshell: ( cd <repo> && … ).`
  );
};

interface GuardOptions {
  platform?: NodeJS.Platform;
  /** The folder the session was launched from; drift is checked only for a session launched in the home. */
  launch?: string;
}

/**
 * The first reason to refuse a shell command, or undefined to let it run. Codex starts every
 * command in the workspace, so a cd never carries over there and drift is checked on Claude only,
 * and only for a session launched in the home (a pinned home also reaches sessions started in a
 * repo). On native Windows Codex runs PowerShell, so only the home-tree check, whose redirects
 * read the same there, applies; the temp-dir and drift checks judge Claude Code's Git Bash.
 */
export function shellGuard(
  command: string,
  cwd: string,
  home: string,
  host: 'claude' | 'codex',
  { platform = process.platform, launch }: GuardOptions = {}
): string | undefined {
  const paths = pathsFor(cwd, home, platform);
  const commands = scanShell(command);
  const { steps, end } = walk(commands, paths);
  const leak = leakIn(steps, paths);
  if (leak) {
    return (
      `Blocked: this shell command would write "${leak}" outside the agent home ${home} (the command's cwd is ${cwd}). ` +
      `Home trees (${HOME_TREES.join('/, ')}/) take the absolute path under ${home}, or cd back to the home first.`
    );
  }
  if (host === 'codex' && platform === 'win32') {
    return undefined;
  }
  const launchedHome = launch === undefined || insideHome(paths.api.resolve(paths.native(launch)), paths);
  return (
    commands.map(scratchProblem).find(Boolean) ??
    (host === 'claude' && launchedHome ? driftMessage(end, paths) : undefined)
  );
}
