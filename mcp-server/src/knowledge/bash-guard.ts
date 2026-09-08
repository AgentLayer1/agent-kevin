import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';

const HOME_TREES = ['knowledge', 'projects', 'reports'];
const RELATIVE_TREE = new RegExp(`(?:^|[\\s;&|(<>'"=])((?:\\./)?(${HOME_TREES.join('|')})/[^\\s;&|)'"]*)`);
const CD = /^\s*cd(?:\s+(["']?)([^"'\s]+)\1)?\s*$/;

const insideHome = (dir: string, home: string): boolean => {
  const fromHome = relative(home, dir);
  return fromHome === '' || (!fromHome.startsWith('..') && !isAbsolute(fromHome));
};

/**
 * The home-relative path a shell command would resolve outside the agent home, or
 * undefined when the command is safe. The cwd the host reports is the starting point;
 * each `cd` segment inside the command moves it, so `cd <repo> && cat > projects/x` is
 * caught even when the host itself never leaves the home. A tree that really exists
 * under the effective cwd (a repo with its own `projects/`) is that repo's, not a leak.
 */
export function homeRelativeLeak(command: string, cwd: string, home: string): string | undefined {
  let dir = cwd;
  for (const segment of command.split(/&&|\|\||;|\n/)) {
    const cd = CD.exec(segment);
    if (cd) {
      const target = cd[2] ?? '~';
      dir = target === '-' ? dir : resolve(dir, target.replace(/^~(?=$|\/)/, homedir()));
      continue;
    }
    if (insideHome(dir, home)) continue;
    const match = RELATIVE_TREE.exec(segment);
    if (match && !existsSync(resolve(dir, match[2]))) {
      return match[1];
    }
  }
  return undefined;
}

/** The block message the hook feeds back to the model. */
export function leakMessage(leak: string, cwd: string, home: string): string {
  return (
    `Blocked: this shell command would resolve "${leak}" outside the agent home ${home} (the command's cwd is ${cwd}). ` +
    `Home trees (${HOME_TREES.join('/, ')}/) take the absolute path under ${home}, or cd back to the home first.`
  );
}
