import { atom, read, update } from 'claude-code';
import type { EngineInterface, On, ToolCallResult, TurnCompleteReason } from 'claude-code';

import { cliArgv } from '../shared/cli';
import {
  CLAUDE_FILES,
  HOME_MARKERS,
  MAX_IMPORT_HOPS,
  dataDirNameIn,
  expandHome,
  foldersUpTo,
  grantFor,
  hasOwnContent,
  importsIn,
  isUnder,
  manualContext,
  parentOf,
  pathsInCommand,
  resolveImport,
  shortName
} from './repo';

// `${loop}:${path}` for each file attached and `${loop}:${folder}/` for each folder already read.
const delivered = atom({ plugin: 'agent-kevin', key: 'delivered' } as const, []);
// Files the current turn attached, shown in the band until the turn ends.
const thisTurn = atom({ plugin: 'agent-kevin', key: 'manualsThisTurn' } as const, []);

const MAIN = 'main';
const TURN_REASONS: readonly TurnCompleteReason[] = ['answer', 'aborted', 'refusal', 'error'];

// Read once per module load; a reload picks up changed grants.
let grantsCache: string[] | undefined;
let dataDirCache: string | undefined;

interface Manual {
  path: string;
  text: string;
}

const loopOf = (agentId: string | undefined): string => agentId ?? MAIN;

const asPaths = (field: unknown): string[] => (typeof field === 'string' ? [field] : []);

async function exists($: EngineInterface, path: string): Promise<boolean> {
  return $.fs.stat(path).then(
    () => true,
    () => false
  );
}

async function grants($: EngineInterface): Promise<string[]> {
  if (grantsCache) {
    return grantsCache;
  }
  const permissions = (await $.settings.read()).permissions;
  const listed =
    typeof permissions === 'object' && permissions !== null && 'additionalDirectories' in permissions
      ? permissions.additionalDirectories
      : [];
  const home = await $.env.get('HOME');
  grantsCache = (Array.isArray(listed) ? listed : [])
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => expandHome(entry, home));
  return grantsCache;
}

/**
 * The plugin's data dir name (`.kevin`), from the CLI that owns it; '' when it can't be read.
 */
async function dataDirName($: EngineInterface): Promise<string> {
  if (dataDirCache === undefined) {
    const { exitCode, stdout } = await $.process.run(cliArgv($.plugin.root, $.plugin.name, ['ping']), {
      cwd: await $.session.root()
    });
    dataDirCache = exitCode === 0 ? dataDirNameIn(stdout) : '';
  }
  return dataDirCache;
}

/**
 * An agent home loads its own instructions through its bridge; it is marked, as the runtime marks
 * one, by a data dir holding a marker file.
 */
async function isAgentHome($: EngineInterface, folder: string): Promise<boolean> {
  const name = await dataDirName($);
  if (!name) {
    return false;
  }
  const marked = await Promise.all(HOME_MARKERS.map((marker) => exists($, `${folder}/${name}/${marker}`)));
  return marked.includes(true);
}

async function findRepoRoot($: EngineInterface, folders: readonly string[]): Promise<string | undefined> {
  const [first, ...rest] = folders;
  if (first === undefined) {
    return undefined;
  }
  return (await exists($, `${first}/.git`)) ? first : findRepoRoot($, rest);
}

/**
 * The repo folders from the root down to `path`'s folder that this loop hasn't read yet, or none
 * outside a granted repo and inside an agent home.
 */
async function foldersFor(
  $: EngineInterface,
  path: string,
  mayBeFolder: boolean,
  done: ReadonlySet<string>
): Promise<string[]> {
  const grant = grantFor(path, await grants($), await $.session.root());
  if (grant === undefined) {
    return [];
  }
  const isFolder =
    mayBeFolder &&
    (await $.fs.stat(path).then(
      (stat) => stat.kind === 'dir',
      () => false
    ));
  const folder = isFolder ? path : parentOf(path);
  // Handling a folder marks every folder from its repo root down, so a repeat touch stops here.
  if (done.has(`${folder}/`)) {
    return [];
  }
  const upward = foldersUpTo(folder, grant);
  const repoRoot = await findRepoRoot($, upward);
  if (repoRoot === undefined || (await isAgentHome($, repoRoot))) {
    return [];
  }
  return upward.slice(0, upward.indexOf(repoRoot) + 1).reverse();
}

/**
 * A folder's Claude files, or its AGENTS.md when it has none: Claude Code's default rule.
 */
async function instructionFiles($: EngineInterface, folder: string): Promise<string[]> {
  const present = async (paths: readonly string[]) =>
    (await Promise.all(paths.map(async (path) => ((await exists($, path)) ? [path] : [])))).flat();
  const claude = await present(CLAUDE_FILES.map((name) => `${folder}/${name}`));
  return claude.length ? claude : present([`${folder}/AGENTS.md`]);
}

/**
 * Each file then its imports, depth-first, skipping anything already seen and any import
 * outside the grants (the mod reads files the Read tool's sandbox would refuse).
 */
async function expand(
  $: EngineInterface,
  files: readonly string[],
  hops: number,
  walk: { allowed: readonly string[]; home: string | undefined; seen: Set<string> }
): Promise<Manual[]> {
  const [file, ...rest] = files;
  if (file === undefined) {
    return [];
  }
  if (walk.seen.has(file)) {
    return expand($, rest, hops, walk);
  }
  walk.seen.add(file);
  const text = await $.fs.read(file).catch(() => undefined);
  if (typeof text !== 'string') {
    return expand($, rest, hops, walk);
  }
  const imports =
    hops >= MAX_IMPORT_HOPS
      ? []
      : importsIn(text)
          .map((ref) => resolveImport(file, ref, walk.home))
          .filter((path) => walk.allowed.some((grant) => isUnder(path, grant)));
  const nested = await expand($, imports, hops + 1, walk);
  return [{ path: file, text }, ...nested, ...(await expand($, rest, hops, walk))];
}

async function withManuals(
  $: EngineInterface,
  result: ToolCallResult,
  touched: readonly string[],
  mayBeFolder: boolean,
  agentId: string | undefined
): Promise<ToolCallResult> {
  if (result.deny !== undefined || touched.length === 0) {
    return result;
  }
  const loop = loopOf(agentId);
  const done = new Set(
    (await read($, delivered)).filter((key) => key.startsWith(`${loop}:`)).map((key) => key.slice(loop.length + 1))
  );
  const folders = [
    ...new Set((await Promise.all(touched.map((path) => foldersFor($, path, mayBeFolder, done)))).flat())
  ].filter((folder) => !done.has(`${folder}/`));
  if (folders.length === 0) {
    return result;
  }
  const files = (await Promise.all(folders.map((folder) => instructionFiles($, folder)))).flat();
  const manuals = await expand($, files, 0, {
    allowed: await grants($),
    home: await $.env.get('HOME'),
    seen: new Set([...done, ...touched])
  });
  const shown = manuals.filter((manual) => hasOwnContent(manual.text));
  await update($, delivered, (list) => [
    ...list,
    ...folders.map((folder) => `${loop}:${folder}/`),
    ...shown.map((manual) => `${loop}:${manual.path}`)
  ]);
  if (loop === MAIN && shown.length) {
    await update($, thisTurn, (list) => [...list, ...shown.map((manual) => manual.path)]);
  }
  return shown.length
    ? {
        ...result,
        context: [...(result.context ?? []), ...shown.map((manual) => manualContext(manual.path, manual.text))]
      }
    : result;
}

export const registerManuals = (on: On): void => {
  // Edit refuses a file the conversation hasn't Read, so the Read already attached its manual.
  on('tool.call', { tool: ['Read', 'Write'] }, async ($, e, next) =>
    withManuals($, await next(e), asPaths(e.file_path), false, e.agentId)
  );

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e);
    return withManuals($, result, pathsInCommand(asPaths(e.command)[0] ?? '', await grants($)), true, e.agentId);
  });

  on('session.compact', async ($, e, next) => {
    const result = await next(e);
    const prefix = `${loopOf(e.agentId)}:`;
    await update($, delivered, (list) => list.filter((key) => !key.startsWith(prefix)));
    return result;
  });

  // A /clear or a resume starts another conversation in the same process.
  on('session.end', { reason: ['clear', 'resume'] }, async ($, e, next) => {
    await update($, delivered, () => []);
    return next(e);
  });

  // Sync owns the unmatched turn.complete; every reason is listed so this one sees each turn too.
  on('turn.complete', { reason: TURN_REASONS }, async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, thisTurn, () => []);
    }
    return next(e);
  });

  on('session.start', { isInteractive: true }, async ($, e, next) => {
    await $.command.register({
      name: 'manuals',
      description: 'Repo instructions attached to this conversation (no Claude turn)'
    });
    return next(e);
  });

  on('command.run', { command: 'manuals' }, async ($) => {
    const allowed = await grants($);
    const files = (await read($, delivered))
      .filter((key) => key.startsWith(`${MAIN}:`) && !key.endsWith('/'))
      .map((key) => shortName(key.slice(MAIN.length + 1), allowed));
    return { text: files.length ? `In context: ${files.join(', ')}` : 'No repo instructions attached yet.' };
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e);
    const attached = await read($, thisTurn);
    if (attached.length === 0 || e.props.hasSurvey) {
      return below;
    }
    const allowed = await grants($);
    const { Box, Text } = $.ui.resolve(e);
    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate-end">
          📎 {attached.map((path) => shortName(path, allowed)).join(' · ')} attached
        </Text>
        {below}
      </Box>
    );
  });
};
