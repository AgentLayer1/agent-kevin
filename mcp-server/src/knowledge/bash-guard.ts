import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { commandWords, scanShell, type ShellCommand } from './shell-scan';

const HOME_TREES = ['knowledge', 'projects', 'reports'];
const TREE = HOME_TREES.join('|');
/** A whole quoted string, or an unquoted word, that starts with a home tree. */
const RELATIVE_TREE = new RegExp(
  `(?:^|[\\s=(])(?:(["'])((?:\\./)?(${TREE})/[^"']*)\\1|((?:\\./)?(${TREE})/[^\\s;&|)"']*))`
);
/** Only a write can misplace a file; a read from the wrong cwd merely fails. */
const WRITES = /(?:^|[\s;&|(])(?:mkdir|touch|cp|mv|tee|install|rsync|ln|sed\s+-i)\s|>/;
const CD = /^\s*\(?\s*(?:cd|pushd)(?:\s+(?:--\s+)?(.+?))?\s*$/;
const HEREDOC = /<<-?\s*(["']?)(\w+)\1/;
const COMPUTED = /[$`(]/;

const insideHome = (dir: string, home: string): boolean => {
  const fromHome = relative(home, dir);
  return fromHome === '' || (!fromHome.startsWith('..') && !isAbsolute(fromHome));
};

/**
 * The home-relative path a shell command would write outside the agent home, or
 * undefined when the command is safe. The cwd the host reports is the starting point;
 * each `cd` inside the command moves it, so `cd <repo> && cat > projects/x` is caught
 * even when the host itself never leaves the home. A `cd` to a value the shell computes
 * (`$VAR`, `$(…)`, `-`) leaves the cwd unknown, and unknown means allow. A tree that
 * really exists under the effective cwd (a repo with its own `projects/`) is that
 * repo's, not a leak. Heredoc bodies are prose, never paths.
 */
export function homeRelativeLeak(command: string, cwd: string, home: string): string | undefined {
  let dir: string | undefined = cwd;
  let heredoc: string | undefined;
  for (const line of command.split('\n')) {
    if (heredoc !== undefined) {
      if (line.trim() === heredoc) heredoc = undefined;
      continue;
    }
    for (const segment of line.split(/&&|\|\||;/)) {
      const cd = CD.exec(segment);
      if (cd) {
        const raw = cd[1] ?? '~';
        const target = raw.replace(/^(["'])(.*)\1$/, '$2').replace(/^~(?=$|\/)/, homedir());
        dir = raw === '-' || COMPUTED.test(raw) ? undefined : isAbsolute(target) ? target : dir && resolve(dir, target);
        continue;
      }
      heredoc = HEREDOC.exec(segment)?.[2] ?? heredoc;
      if (!dir || insideHome(dir, home) || !WRITES.test(segment)) continue;
      const match = RELATIVE_TREE.exec(segment);
      const leak = match?.[2] ?? match?.[4];
      const tree = match?.[3] ?? match?.[5];
      if (leak && tree && !existsSync(resolve(dir, tree))) {
        return leak;
      }
    }
  }
  return undefined;
}

/** The block message the hook feeds back to the model. */
export function leakMessage(leak: string, cwd: string, home: string): string {
  return (
    `Blocked: this shell command would write "${leak}" outside the agent home ${home} (the command's cwd is ${cwd}). ` +
    `Home trees (${HOME_TREES.join('/, ')}/) take the absolute path under ${home}, or cd back to the home first.`
  );
}

const TEMP_PATH = /^(?:\$(?:TMPDIR\b|\{TMPDIR[^}]*\})|\/(?:private\/)?tmp|\/var\/folders)(?:\/|$)/;
const TEMP_ROOT =
  /^(?:\$(?:TMPDIR\b|\{TMPDIR[^}]*\})|\/(?:private\/)?tmp(?:\/claude-\d+)?|\/var\/folders\/[^/]+\/[^/]+\/T)\/?$/;
const HAND_PICKED = /(?:^|=)(\$(?:TMPDIR\b|\{TMPDIR[^}]*\})\/[^/]+)/;
const COMPUTED_DIR = /[$`*?[]/;

/**
 * Why a command misuses the shared temp dir, or undefined. `$TMPDIR` is one folder for every
 * session on the machine, so a scratch path found by pattern or listing can be another
 * session's, and a name written by hand can be written by another session at the same time.
 */
export function scratchProblem(commands: ShellCommand[]): string | undefined {
  const fix = 'Make scratch with mktemp "$TMPDIR/<prefix>-XXXXXX" (or mktemp -d) and use the exact path it prints.';
  const problems = commands.flatMap((command) => {
    const [name, ...args] = commandWords(command);
    const globbed = command.words.find((word) => word.globbed && TEMP_PATH.test(word.text));
    const listed = (name?.text === 'ls' || name?.text === 'find') && args.find((word) => TEMP_ROOT.test(word.text));
    const picked =
      name?.text === 'mktemp' ? undefined : command.words.map((word) => HAND_PICKED.exec(word.text)?.[1]).find(Boolean);
    return [
      globbed &&
        `Blocked: ${globbed.text} finds scratch by pattern in the shared temp dir, which every session on this machine writes to, so it can match another session's files. ${fix}`,
      listed &&
        `Blocked: listing or searching the shared temp dir (${listed.text}) finds other sessions' scratch too. ${fix}`,
      picked &&
        `Blocked: ${picked} is a hand-picked name in the shared temp dir, which another session can write at the same moment. ${fix}`
    ].filter((problem): problem is string => Boolean(problem));
  });
  return problems[0];
}

const resolveCd = (dir: string | undefined, command: ShellCommand): string | undefined => {
  const [name, ...args] = commandWords(command);
  if (name?.text !== 'cd' && name?.text !== 'pushd' && name?.text !== 'popd') {
    return dir;
  }
  const target = args.find((word) => word.text === '-' || !word.text.startsWith('-'));
  if (name.text === 'popd' || (name.text === 'pushd' && !target)) {
    return undefined;
  }
  const raw = target?.text ?? '~';
  if (raw === '-' || COMPUTED_DIR.test(raw)) {
    return undefined;
  }
  const path = raw.replace(/^~(?=$|\/)/, homedir());
  return isAbsolute(path) ? resolve(path) : dir && resolve(dir, path);
};

/**
 * The block message when a command would leave the session's shell outside the agent home, or
 * undefined. Under Claude Code a cd in one call carries over to every later call; one inside a
 * subshell or command substitution doesn't, so only top-level commands move it. A target the
 * shell computes (`$VAR`, `-`, `popd`) can't be read here and is let through; if it did leave the
 * home, the session has drifted, and every command after it is refused until one returns.
 */
export function driftMessage(commands: ShellCommand[], cwd: string, home: string): string | undefined {
  const end = commands.filter((command) => command.depth === 0).reduce<string | undefined>(resolveCd, cwd);
  if (end === undefined || insideHome(end, home)) {
    return undefined;
  }
  if (end === cwd) {
    return (
      `Blocked: the session's working directory is ${cwd}, outside the agent home ${home}, because an earlier cd moved it. ` +
      `Run cd ${home} first (alone, or as this command's start), then name other repos with git -C <repo> and absolute paths.`
    );
  }
  return (
    `Blocked: this command would leave the session's working directory at ${end}, outside the agent home ${home}, ` +
    `and a cd carries over to every later command. Name the repo instead (git -C <repo>, absolute paths), or keep the cd in a subshell: ( cd <repo> && … ).`
  );
}

export type GuardHost = 'claude' | 'codex';

/**
 * The first reason to refuse a shell command, or undefined to let it run. Codex starts every
 * command in the workspace, so a cd never carries over there and drift is checked on Claude only.
 */
export function shellGuard(command: string, cwd: string, home: string, host: GuardHost): string | undefined {
  const leak = homeRelativeLeak(command, cwd, home);
  if (leak) {
    return leakMessage(leak, cwd, home);
  }
  const commands = scanShell(command);
  return scratchProblem(commands) ?? (host === 'claude' ? driftMessage(commands, cwd, home) : undefined);
}
