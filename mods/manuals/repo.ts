// Pure path logic. The mod runtime has no node:path, so these work on POSIX absolute paths
// (macOS-first). TODO(windows): drive letters and backslashes are not handled.

/**
 * A folder's Claude instruction files, in the order Claude Code reads them; AGENTS.md is read
 * only when a folder has none of these.
 */
export const CLAUDE_FILES = ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'];

/**
 * Imports nest at most this deep, as in Claude Code's own loader.
 */
export const MAX_IMPORT_HOPS = 4;

/**
 * The files whose presence in a data dir marks an agent home: the runtime's own
 * `HOME_MARKER_FILES` (mcp-server/src/shared/naming.ts), which a test keeps equal.
 */
export const HOME_MARKERS = ['version.json', 'knowledge.json'];

const CODE = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g;
const IMPORT = /(?:^|\s)@(\S+)/g;

const trimSlash = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path);

export const parentOf = (path: string): string => {
  const trimmed = trimSlash(path);
  const cut = trimmed.lastIndexOf('/');
  return cut <= 0 ? '/' : trimmed.slice(0, cut);
};

/**
 * The data dir's folder name (`.state`) from the CLI's `ping` output, or '' when it can't be read.
 */
export const dataDirNameIn = (ping: string): string => {
  try {
    const data: unknown = (JSON.parse(ping) as { data?: unknown }).data;
    return typeof data === 'string' ? data.slice(trimSlash(data).lastIndexOf('/') + 1) : '';
  } catch {
    return '';
  }
};

export const isUnder = (path: string, folder: string): boolean => {
  const base = trimSlash(folder);
  return path === base || path.startsWith(`${base}/`);
};

export const expandHome = (path: string, home: string | undefined): string =>
  home !== undefined && (path === '~' || path.startsWith('~/')) ? `${home}${path.slice(1)}` : path;

const normalize = (path: string): string =>
  `/${path
    .split('/')
    .reduce<string[]>(
      (parts, segment) =>
        segment === '' || segment === '.' ? parts : segment === '..' ? parts.slice(0, -1) : [...parts, segment],
      []
    )
    .join('/')}`;

/**
 * The granted folder holding `path`, skipping anything under the session root (the engine's own
 * instruction loading covers that tree).
 */
export const grantFor = (path: string, grants: readonly string[], sessionRoot: string): string | undefined =>
  isUnder(path, sessionRoot) ? undefined : grants.find((grant) => isUnder(path, grant));

/**
 * Folders from `dir` up to and including `stop`, nearest first.
 */
export const foldersUpTo = (dir: string, stop: string): string[] =>
  dir === trimSlash(stop) || !isUnder(dir, stop) || dir === '/'
    ? [trimSlash(stop)]
    : [dir, ...foldersUpTo(parentOf(dir), stop)];

/**
 * Where `@ref` in `fromFile` points: relative to that file's folder, `~/` from home, or absolute.
 */
export const resolveImport = (fromFile: string, ref: string, home: string | undefined): string =>
  normalize(ref.startsWith('/') || ref.startsWith('~/') ? expandHome(ref, home) : `${parentOf(fromFile)}/${ref}`);

/**
 * The `@path` imports in a file, skipping code spans and fenced blocks as Claude Code does.
 */
export const importsIn = (text: string): string[] =>
  [...text.replace(CODE, ' ').matchAll(IMPORT)]
    .map((match) => (match[1] ?? '').replace(/[.,;:!?)\]]+$/, ''))
    .filter(Boolean);

/**
 * False for a file that holds nothing but `@` imports (a bridge): its imports carry the content.
 */
export const hasOwnContent = (text: string): boolean =>
  text
    .split('\n')
    .map((line) => line.trim())
    .some((line) => line !== '' && !line.startsWith('@') && !line.startsWith('<!--'));

/**
 * Absolute paths in a shell command that fall under a grant.
 */
export const pathsInCommand = (command: string, grants: readonly string[]): string[] =>
  (command.match(/\/[^\s'"`;&|<>()]+/g) ?? []).filter((path) => grants.some((grant) => isUnder(path, grant)));

/**
 * A short name for the band and /manuals: the path from the grant's parent folder down.
 */
export const shortName = (path: string, grants: readonly string[]): string => {
  const grant = grants.find((candidate) => isUnder(path, candidate));
  return grant === undefined ? path : path.slice(parentOf(grant).length + 1);
};

export const manualContext = (path: string, text: string): string =>
  `Contents of ${path} (this repo's agent instructions, attached the first time the session touched it):\n\n${text}`;
