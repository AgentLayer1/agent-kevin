import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';

const HOME_TREES = ['knowledge', 'projects', 'reports'];
const TREE = HOME_TREES.join('|');
/** A whole quoted string, or an unquoted word, that starts with a home tree. */
const RELATIVE_TREE = new RegExp(
  `(?:^|[\\s=(])(?:(["'])((?:\\./)?(${TREE})/[^"']*)\\1|((?:\\./)?(${TREE})/[^\\s;&|)"']*))`
);
/** Only a write can misplace a file; a read from the wrong cwd merely fails. */
const WRITES = /(?:^|[\s;&|(])(?:mkdir|touch|cp|mv|tee|install|rsync|ln|sed\s+-i)\s|>/;
const CD = /^\s*(?:cd|pushd)(?:\s+(.+?))?\s*$/;
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
