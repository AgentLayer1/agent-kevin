/**
 * Which of a home's two Claude settings files owns an entry. `settings.json` is shared: it is
 * committed, synced and seeded, so it holds the agent's policy and defaults, correct unchanged for
 * a teammate on the same OS with another username and plugin install. `settings.local.json` is
 * this machine's: where things live here, how this machine runs the plugin, and personal overrides.
 * Lists merge across the two files and a local scalar wins, so moving an entry never drops it.
 * A leaf on purpose (node builtins and the equally bare `shared/naming`), so skill scripts and
 * upgrade migrations can import it.
 */
import { agentEnvPrefix } from '@/shared/naming';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, posix, resolve, win32 } from 'node:path';

export type SettingsOwner = 'shared' | 'local';
export type Json = Record<string, unknown>;

export const settingsPath = (home: string, owner: SettingsOwner): string =>
  join(home, '.claude', owner === 'shared' ? 'settings.json' : 'settings.local.json');

const FOLDER_LISTS: readonly (readonly string[])[] = [
  ['permissions', 'additionalDirectories'],
  ['sandbox', 'filesystem', 'allowWrite']
];

const RULE_LISTS: readonly (readonly string[])[] = [
  ['permissions', 'allow'],
  ['permissions', 'ask'],
  ['permissions', 'deny']
];

export interface ScopeContext {
  /** This plugin's name: its `enabledPlugins` id names a marketplace that differs between a clone and a marketplace install. */
  plugin: string;
  /** Folders an older init granted by path: the external knowledge, projects and reports roots. */
  folderRoots: readonly string[];
}

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const GLOB = /[*?[\]{}]/;

/**
 * A path that names a concrete place on one machine: absolute, and anchored at a named folder.
 * `//**` and `//c/**` are absolute too but match on any machine, and `~/` is home-relative.
 */
export const isMachinePath = (path: string): boolean => {
  const trimmed = path.trim();
  if (trimmed.startsWith('~') || !(posix.isAbsolute(trimmed) || win32.isAbsolute(trimmed))) {
    return false;
  }
  const [head, next] = trimmed
    .replace(/^[A-Za-z]:/, '')
    .split(/[\\/]+/)
    .filter(Boolean);
  const anchor = trimmed.startsWith('//') && /^[a-z]$/i.test(head ?? '') ? next : head;
  return anchor !== undefined && !GLOB.test(anchor);
};

/**
 * An absolute path in the form `Read(…)` / `Edit(…)` rules read as absolute: a single leading slash
 * there is project-relative. Windows drives use the POSIX form Claude Code matches against
 * (`C:\Users\a` → `//c/Users/a`). Null for a path with no rule form (a UNC share, a relative path).
 */
export const toRulePath = (path: string): string | null => {
  const drive = /^([A-Za-z]):[\\/]/.exec(path);
  if (drive?.[1]) {
    return `//${drive[1].toLowerCase()}/${path.slice(3).replaceAll('\\', '/')}`;
  }
  if (path.startsWith('\\\\')) {
    return null;
  }
  if (path.startsWith('//')) {
    return path;
  }
  return path.startsWith('/') ? `/${path}` : null;
};

const RULE = /^(\w+)\((.*)\)$/s;
/** Tools whose rule argument is a path; only `Read` and `Edit` rules are ever consulted. */
const PATH_TOOL: Readonly<Record<string, 'Read' | 'Edit'>> = {
  Read: 'Read',
  Glob: 'Read',
  Edit: 'Edit',
  Write: 'Edit',
  NotebookEdit: 'Edit',
  MultiEdit: 'Edit'
};

const underRoot = (path: string, roots: readonly string[]): boolean =>
  roots.some((root) => path === root || path.startsWith(`${root}/`) || path.startsWith(`${root}\\`));

/**
 * The file a permission rule belongs in, and the rule as it belongs there: a rule naming a concrete
 * folder is this machine's. An older init wrote custom-folder rules as `Read(/abs/**)`, which never
 * matched, so those come back in their working `//abs` form.
 */
export const placeRule = (rule: string, context: ScopeContext): { owner: SettingsOwner; rule: string } => {
  const [, tool = '', argument = ''] = RULE.exec(rule.trim()) ?? [];
  const canonical = PATH_TOOL[tool];
  if (canonical && argument.startsWith('//')) {
    return { owner: isMachinePath(argument) ? 'local' : 'shared', rule };
  }
  const legacy = /^[A-Za-z]:[\\/]/.test(argument) || underRoot(argument, context.folderRoots);
  const path = canonical && legacy ? toRulePath(argument) : null;
  return path === null ? { owner: 'shared', rule } : { owner: 'local', rule: `${canonical}(${path})` };
};

/** The folder roots an older init granted, from the home's env under either spelling, tilde-expanded. */
export const legacyFolderRoots = (...envs: readonly Readonly<Record<string, unknown>>[]): string[] => {
  const expand = (path: string): string =>
    path === '~' ? homedir() : path.startsWith('~/') ? resolve(homedir(), path.slice(2)) : path;
  const roots = ['KNOWLEDGE', 'PROJECTS', 'REPORTS'].flatMap((suffix) =>
    envs.flatMap((env) =>
      [`${agentEnvPrefix()}${suffix}`, `AGENT_${suffix}`]
        .map((key) => env[key])
        .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
        .map((path) => expand(path.trim()).replace(/[\\/]+$/, ''))
    )
  );
  return [...new Set(roots)];
};

export interface Move {
  key: string;
  entry: unknown;
  /** The entry as written to the local file, when it differs. */
  rewritten?: unknown;
}

const childAt = (root: Json, path: readonly string[], create: boolean): Json | undefined =>
  path.reduce<Json | undefined>((node, key) => {
    if (!node) {
      return undefined;
    }
    if (!isObject(node[key])) {
      if (!create) {
        return undefined;
      }
      node[key] = {};
    }
    return node[key] as Json;
  }, root);

/** Remove a key the move emptied, and each object that emptied with it; an operator's own empty key is never reached. */
const pruneEmptied = (node: Json, path: readonly string[]): void => {
  const [head, ...rest] = path;
  if (head === undefined) {
    return;
  }
  const child = node[head];
  if (rest.length === 0 || !isObject(child)) {
    delete node[head];
    return;
  }
  pruneEmptied(child, rest);
  if (Object.keys(child).length === 0) {
    delete node[head];
  }
};

/**
 * Move the part of a list or object the shared file holds that `mine` picks into the local file
 * under the same path. A list unions; an object keeps a key the local file already sets.
 */
const moveOut = (
  shared: Json,
  local: Json,
  path: readonly string[],
  mine: (key: string, entry: unknown) => { move: boolean; rewritten?: unknown },
  moves: Move[]
): void => {
  const owner = childAt(shared, path.slice(0, -1), false);
  const key = path[path.length - 1] ?? '';
  const value = owner?.[key];
  const isList = Array.isArray(value);
  if (!owner || !(isList || isObject(value))) {
    return;
  }
  const entries: [string, unknown][] = isList ? value.map((entry) => ['', entry]) : Object.entries(value);
  const picked = entries.map(([name, entry]) => ({ name, entry, ...mine(name, entry) }));
  const leaving = picked.filter((item) => item.move);
  if (leaving.length === 0) {
    return;
  }
  const target = childAt(local, path.slice(0, -1), true) ?? local;
  const current = target[key];
  if (current !== undefined && Array.isArray(current) !== isList) {
    throw new Error(`${path.join('.')} in the local settings is not a ${isList ? 'list' : 'object'}`);
  }
  target[key] = isList
    ? [
        ...new Set([
          ...((current as unknown[] | undefined) ?? []),
          ...leaving.map((item) => item.rewritten ?? item.entry)
        ])
      ]
    : { ...Object.fromEntries(leaving.map((item) => [item.name, item.entry])), ...(current as Json | undefined) };
  const staying = picked.filter((item) => !item.move);
  if (staying.length === 0) {
    pruneEmptied(shared, path);
  } else {
    owner[key] = isList
      ? staying.map((item) => item.entry)
      : Object.fromEntries(staying.map((item) => [item.name, item.entry]));
  }
  leaving.forEach(({ name, entry, rewritten }) =>
    moves.push({
      key: isList ? path.join('.') : [...path, name].join('.'),
      entry,
      ...(rewritten === undefined || rewritten === entry ? {} : { rewritten })
    })
  );
};

const commandNamesMachinePath = (statusLine: unknown): boolean =>
  isObject(statusLine) &&
  typeof statusLine.command === 'string' &&
  statusLine.command.split(/["'\s]+/).some((token) => token !== '' && isMachinePath(token));

/**
 * Move every entry the shared file holds that names this machine into the local file: a status line
 * running a command by absolute path, this plugin's `enabledPlugins` id and the marketplace it names,
 * an absolute folder grant, and a permission rule on a concrete folder. Pure: the inputs are not
 * changed. A local value already set wins over the moved one.
 */
export const splitSettings = (
  sharedIn: Json,
  localIn: Json,
  context: ScopeContext
): { shared: Json; local: Json; moves: Move[] } => {
  const shared = structuredClone(sharedIn);
  const local = structuredClone(localIn);
  const moves: Move[] = [];

  if (commandNamesMachinePath(shared.statusLine)) {
    local.statusLine ??= shared.statusLine;
    moves.push({ key: 'statusLine', entry: shared.statusLine });
    delete shared.statusLine;
  }
  const ours = (id: string): boolean => id.startsWith(`${context.plugin}@`);
  const marketplaces = new Set(
    Object.keys(isObject(shared.enabledPlugins) ? shared.enabledPlugins : {})
      .filter(ours)
      .map((id) => id.slice(context.plugin.length + 1))
  );
  moveOut(shared, local, ['enabledPlugins'], (id) => ({ move: ours(id) }), moves);
  moveOut(shared, local, ['extraKnownMarketplaces'], (name) => ({ move: marketplaces.has(name) }), moves);
  FOLDER_LISTS.forEach((path) =>
    moveOut(shared, local, path, (_, entry) => ({ move: typeof entry === 'string' && isMachinePath(entry) }), moves)
  );
  RULE_LISTS.forEach((path) =>
    moveOut(
      shared,
      local,
      path,
      (_, entry) => {
        if (typeof entry !== 'string') {
          return { move: false };
        }
        const placed = placeRule(entry, context);
        return { move: placed.owner === 'local', rewritten: placed.rule };
      },
      moves
    )
  );
  return { shared, local, moves };
};

/** A settings file as an object: `{}` when absent, and a throw when it is not a JSON object. */
export const readSettingsFile = (path: string): Json => {
  if (!existsSync(path)) {
    return {};
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  if (!isObject(parsed)) {
    throw new Error(`${path} is not a JSON object`);
  }
  return parsed;
};

/** The file's own layout, so a rewrite keeps compact compact and CRLF CRLF. */
const layoutOf = (text: string): { lead: string; indent: string; eol: string; trailing: string } => {
  const lead = /^\s*/.exec(text)?.[0] ?? '';
  const body = text.slice(lead.length);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return {
    lead,
    indent: /^\{\r?\n([ \t]+)"/.exec(body)?.[1] ?? (/^\{\r?\n/.test(body) || body === '' ? '  ' : ''),
    eol,
    trailing: /\r?\n$/.test(text) || text === '' ? eol : ''
  };
};

/** Atomic, in the file's existing layout, and through a symlink (settings kept in a dotfiles repo) rather than over it. */
export const writeSettingsFile = (path: string, settings: Json): void => {
  const target = existsSync(path) ? realpathSync(path) : path;
  const { lead, indent, eol, trailing } = layoutOf(existsSync(target) ? readFileSync(target, 'utf-8') : '');
  // JSON.stringify escapes newlines inside strings, so every newline it emits is structural.
  const json = JSON.stringify(settings, null, indent).replaceAll('\n', eol);
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, `${lead}${json}${trailing}`);
    renameSync(tmp, target);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
};

export interface SettleReport {
  moved: Record<string, unknown[]>;
  rewritten: Array<{ from: unknown; to: unknown }>;
}

/**
 * Move the entries that name this machine out of the shared file. The local file is written before
 * the shared one is stripped, so an interruption leaves an entry in both files, never in neither,
 * and the next run finishes the move. A file that is not a JSON object throws before any write.
 */
export const settleSettings = (home: string, plugin: string, env: Readonly<Record<string, unknown>>): SettleReport => {
  const sharedPath = settingsPath(home, 'shared');
  const localPath = settingsPath(home, 'local');
  const shared = readSettingsFile(sharedPath);
  const local = readSettingsFile(localPath);
  const folderRoots = legacyFolderRoots(isObject(local.env) ? local.env : {}, env);
  const split = splitSettings(shared, local, { plugin, folderRoots });
  if (split.moves.length > 0) {
    writeSettingsFile(localPath, split.local);
    writeSettingsFile(sharedPath, split.shared);
  }
  return {
    moved: split.moves.reduce<Record<string, unknown[]>>(
      (byKey, move) => ({ ...byKey, [move.key]: [...(byKey[move.key] ?? []), move.entry] }),
      {}
    ),
    rewritten: split.moves.flatMap((move) =>
      move.rewritten === undefined ? [] : [{ from: move.entry, to: move.rewritten }]
    )
  };
};

/** Both files and the view Claude Code acts on: lists combined, a local scalar or object over the shared one. */
export const readMergedSettings = (home: string): { shared: Json; local: Json; merged: Json } => {
  const shared = readSettingsFile(settingsPath(home, 'shared'));
  const local = readSettingsFile(settingsPath(home, 'local'));
  return { shared, local, merged: mergeSettings(shared, local) };
};

/** Keys Claude Code replaces whole rather than merging: the status line, and one marketplace's entry. */
const replacedWhole = (key: string, parent: string | undefined): boolean =>
  key === 'statusLine' || parent === 'extraKnownMarketplaces';

export const mergeSettings = (lower: Json, higher: Json, parent?: string): Json =>
  Object.fromEntries(
    [...new Set([...Object.keys(lower), ...Object.keys(higher)])].map((key) => {
      const [under, over] = [lower[key], higher[key]];
      if (over === undefined) {
        return [key, under];
      }
      if (Array.isArray(under) && Array.isArray(over)) {
        return [key, [...under, ...over.filter((entry) => !under.includes(entry))]];
      }
      return [
        key,
        isObject(under) && isObject(over) && !replacedWhole(key, parent) ? mergeSettings(under, over, key) : over
      ];
    })
  );
