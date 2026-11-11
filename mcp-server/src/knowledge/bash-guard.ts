import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { existingTarget } from '../shared/paths';
import { commandWords, scanShell, type ShellCommand, type ShellJoiner } from './shell-scan';

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

const pathsFor = (cwd: string, home: string, platform: NodeJS.Platform): Paths => {
  const api = platform === 'win32' ? win32 : posix;
  const native = platform === 'win32' ? driveForm : (path: string) => path;
  const resolvedHome = api.resolve(native(home));
  return { api, native, home: resolvedHome, realHome: existingTarget(resolvedHome), start: api.resolve(native(cwd)) };
};

const within = (root: string, dir: string, api: typeof posix): boolean => {
  const fromRoot = api.relative(root, dir);
  return fromRoot !== '..' && !fromRoot.startsWith(`..${api.sep}`) && !api.isAbsolute(fromRoot);
};

const insideHome = (dir: string, { api, home, realHome }: Paths): boolean =>
  within(home, dir, api) || within(realHome, existingTarget(dir), api);

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
  // `$HOME` in single quotes is a folder named $HOME; its literal `$` still reads as computed below.
  const raw =
    target === undefined
      ? homedir()
      : target.text.replace(target.expands ? HOME_PREFIX : /^~(?=$|\/)/, homedir());
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
 * that shell's directory unknown.
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

const samePlace = (dir: string, target: string, api: typeof posix): boolean =>
  api.relative(target, dir) === '' || api.relative(existingTarget(target), existingTarget(dir)) === '';

const ECHO_LIMIT = 1500;

/**
 * The block message when the session's shell ends anywhere but where it started or the home: a
 * top-level cd into a folder inside the home, or to a target the shell computes.
 */
const moveMessage = (command: string, end: string | undefined, paths: Paths): string | undefined => {
  if (end !== undefined && (samePlace(end, paths.start, paths.api) || samePlace(end, paths.home, paths.api))) {
    return undefined;
  }
  const subshell = command.length <= ECHO_LIMIT ? `( ${command}\n)` : '( cd <dir> && … )';
  return (
    `Blocked: this command moves the session's working directory to ${end ?? 'a directory the shell computes'}, and a cd carries over to every later command. ` +
    `Name the folder with absolute paths or git -C <repo>, or run the same command in a subshell:\n${subshell}`
  );
};

/** Global options that take the next word as their value, so it isn't the subcommand. */
const GIT_VALUE_OPTIONS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--config-env',
  '--super-prefix'
]);

const subcommandAt = (texts: string[], index: number): number =>
  texts[index]?.startsWith('-')
    ? subcommandAt(texts, index + (GIT_VALUE_OPTIONS.has(texts[index] ?? '') ? 2 : 1))
    : index;

/** The command's words from its name on, redirections and their targets dropped. */
const plainTexts = (command: ShellCommand): string[] => {
  const words = commandWords(command);
  return words.filter((word, index) => !word.operator && !words[index - 1]?.operator).map((word) => word.text);
};

const gitParts = (command: ShellCommand): { sub: string | undefined; args: string[] } => {
  const texts = plainTexts(command);
  if (texts[0] !== 'git') {
    return { sub: undefined, args: [] };
  }
  const at = subcommandAt(texts, 1);
  return { sub: texts[at], args: texts.slice(at + 1) };
};

const OURS_PAIR = /^(?:-s|-X|--strategy|--strategy-option)$/;
const OURS_WORD = /^(?:-sours|-Xours|--strategy=ours|--strategy-option=ours)$/;

const rewriteOf = ({ sub, args }: { sub: string | undefined; args: string[] }): string | undefined => {
  if (sub === 'commit' && args.includes('--amend')) {
    return 'commit --amend';
  }
  return sub === 'merge' &&
    args.some((arg, index) => OURS_WORD.test(arg) || (OURS_PAIR.test(arg) && args[index + 1] === 'ours'))
    ? 'merge with the ours strategy'
    : undefined;
};

const READ_ONLY_STASH = new Set(['list', 'show']);

const stashMessage = (commands: ShellCommand[]): string | undefined =>
  commands.some((command) => {
    const { sub, args } = gitParts(command);
    return sub === 'stash' && !READ_ONLY_STASH.has(args[0] ?? '');
  })
    ? 'Blocked: git stash is shared by every worktree and session on this repo, so an agent only reads it (stash list, stash show). ' +
      'Stage exactly what the commit needs instead of stashing around the index, and set work aside on a temp branch or a scratch copy.'
    : undefined;

const rewriteMessage = (commands: ShellCommand[]): string | undefined => {
  const rewrite = commands.map((command) => rewriteOf(gitParts(command))).find(Boolean);
  return (
    rewrite &&
    `Blocked: git ${rewrite} rewrites or hides history, and git here is forward-only (AGENTS.md, Workflow): ` +
      `fix a commit with a new commit on top, and merge without discarding the other side. ` +
      `The one exception, scrubbing a confidentiality leak from an unpushed commit, is the operator's to run with !.`
  );
};

const GATE_TOOLS = new Set(['tsc', 'eslint', 'prettier', 'swiftlint', 'biome', 'vitest', 'jest']);
const RUNNERS = new Set([
  'pnpm',
  'npm',
  'npx',
  'bun',
  'bunx',
  'yarn',
  'make',
  'turbo',
  'cargo',
  'go',
  'swift',
  'uv',
  'deno'
]);
const GATE_WORD = /^(?:test|tests|lint|typecheck|type-check|check|build|gate|format|verify)(?::[\w:-]+)?$/;
const PUBLISHES = new Set(['commit', 'merge', 'push']);
const UNJOINED = new Set<ShellJoiner>(['||', ';', '\n', '&']);

const isGate = (command: ShellCommand): boolean => {
  const [name = '', ...rest] = commandWords(command).map((word) => word.text);
  return (
    GATE_TOOLS.has(name) || (RUNNERS.has(name) && rest.some((word) => GATE_TOOLS.has(word) || GATE_WORD.test(word)))
  );
};

const setsPipefail = (command: ShellCommand): boolean => {
  const [name, ...rest] = commandWords(command).map((word) => word.text);
  return name === 'set' && rest.some((word) => word.includes('pipefail'));
};

const spoken = (command: ShellCommand): string => plainTexts(command).join(' ').slice(0, 80);

/**
 * Why a gate earlier in the command can't stop the commit, merge or push after it: a separator
 * other than && between them, or the gate piped into another command without pipefail. Only a
 * separator written in the gate's own shell or one enclosing it counts, so a `;` inside a sibling
 * subshell or a substitution in the commit's arguments is not between them.
 */
const gateMessage = (commands: ShellCommand[]): string | undefined =>
  commands
    .map((command, index) => {
      const { sub } = gitParts(command);
      const gate = sub && PUBLISHES.has(sub) ? commands.slice(0, index).findLastIndex(isGate) : -1;
      if (gate < 0) {
        return undefined;
      }
      const gateCommand = commands[gate];
      const between = commands
        .slice(gate + 1, index + 1)
        .flatMap((step) =>
          step.joiner && gateCommand.shells.includes(step.joiner.shell) ? [{ step, joiner: step.joiner }] : []
        );
      const [next] = between;
      if (next?.joiner.separator === '|' && !commands.slice(0, gate).some(setsPipefail)) {
        return (
          `Blocked: "${spoken(gateCommand)}" is piped into ${plainTexts(next.step)[0]}, so the pipe reports that command's status and git ${sub} runs even when the gate fails. ` +
          `Drop the pipe, or put set -o pipefail first.`
        );
      }
      const loose = between.find(({ joiner }) => UNJOINED.has(joiner.separator))?.joiner.separator;
      return (
        loose &&
        `Blocked: git ${sub} runs even when "${spoken(gateCommand)}" fails, because a ${loose === '\n' ? 'new line' : `'${loose}'`} sits between them. ` +
          `Join every step from the gate to the git command with && so a failing gate stops it.`
      );
    })
    .find(Boolean);

interface GuardOptions {
  platform?: NodeJS.Platform;
  /** The folder the session was launched from; drift is checked only for a session launched in the home. */
  launch?: string;
}

/**
 * The first reason to refuse a shell command, or undefined to let it run. History-rewriting git
 * and an unjoined gate are refused on both hosts. Codex starts every command in the workspace,
 * so a cd never carries over there and drift is checked on Claude only,
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
    rewriteMessage(commands) ??
    stashMessage(commands) ??
    gateMessage(commands) ??
    (host === 'claude' && launchedHome ? (driftMessage(end, paths) ?? moveMessage(command, end, paths)) : undefined)
  );
}
