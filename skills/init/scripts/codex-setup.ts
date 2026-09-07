#!/usr/bin/env bun
/**
 * The per-home Codex wiring: hooks in `<home>/.codex/hooks.json` (the SessionStart
 * context with Codex's per-hook output cap lifted, the SessionEnd capture, and the
 * PreCompact capture that saves a long session before Codex compacts it) and the `kevin` MCP
 * server in `<home>/.codex/config.toml`, every command pointing at this plugin checkout
 * and this home. Codex has no `@-import`, and a plugin cannot bundle hooks or an MCP
 * server that knows which home it serves (the server is launched inside the plugin
 * cache, with no workspace variable and no MCP roots), so init and upgrade write both
 * files. Only Kevin's own entries are replaced: the operator's other hooks, MCP servers,
 * and settings survive, and a file that does not parse is left alone.
 *
 * Usage: codex-setup.ts --home <dir> [--plugin-root <dir>] [--write]
 *   Prints the merged hooks document. With --write it writes both files when their
 *   content differs and prints `{ hooks: { path, changed }, mcp: { path, changed }, entries }`,
 *   so the caller knows a hook re-trust is due.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** A hook command of ours, whichever checkout (quoted or not) it points at. */
const AGENT_COMMAND = /bin\/kevin'? session-(start|capture) .*--hook-protocol=codex/;
interface HookItem {
  type: string;
  command?: string;
  timeout?: number;
  /** Codex truncates a hook's context at ~2,500 tokens unless this is raised; 0 lifts the cap. */
  additionalContextLimit?: number;
}
interface HookGroup {
  matcher?: string;
  hooks: HookItem[];
}
interface HooksDocument {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};
const home = flag('home');
if (!home) {
  process.stderr.write('usage: codex-setup.ts --home <dir> [--plugin-root <dir>] [--write]\n');
  process.exit(2);
}
if (process.platform === 'win32') {
  throw new Error(
    'TODO(windows): the hook commands use POSIX env-prefix syntax, which Codex on native Windows does not run'
  );
}

const homeDir = resolve(home);
const pluginRoot = resolve(flag('plugin-root') ?? resolve(import.meta.dir, '..', '..', '..'));
const hooksPath = resolve(homeDir, '.codex', 'hooks.json');
const configPath = resolve(homeDir, '.codex', 'config.toml');

const quote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
const command = (rest: string): string =>
  `AGENT_HOME=${quote(homeDir)} bun ${quote(resolve(pluginRoot, 'bin', 'kevin'))} ${rest}`;
const entry = (commandLine: string, timeout: number, extra: Partial<HookItem> = {}): HookGroup => ({
  matcher: '',
  hooks: [{ type: 'command', command: commandLine, timeout, ...extra }]
});
const isAgentEntry = (item: HookItem): boolean => typeof item.command === 'string' && AGENT_COMMAND.test(item.command);
const withoutAgentEntries = (groups: HookGroup[] = []): HookGroup[] =>
  groups
    .map((group) => ({ ...group, hooks: group.hooks.filter((item) => !isAgentEntry(item)) }))
    .filter((group) => group.hooks.length > 0);

const readHooks = (): HooksDocument => {
  if (!existsSync(hooksPath)) return {};
  const parsed: unknown = JSON.parse(readFileSync(hooksPath, 'utf-8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${hooksPath} is not a JSON object`);
  }
  const document = parsed as HooksDocument;
  for (const [event, groups] of Object.entries(document.hooks ?? {})) {
    if (!Array.isArray(groups) || groups.some((group) => !Array.isArray(group?.hooks))) {
      throw new Error(`${hooksPath}: hooks.${event} is not a list of hook groups`);
    }
  }
  return document;
};
const existingHooks = readHooks();
const hooksDocument: HooksDocument = {
  ...existingHooks,
  hooks: {
    ...existingHooks.hooks,
    SessionStart: [
      ...withoutAgentEntries(existingHooks.hooks?.SessionStart),
      entry(command('session-start --hook-protocol=codex'), 15, { additionalContextLimit: 0 })
    ],
    SessionEnd: [
      ...withoutAgentEntries(existingHooks.hooks?.SessionEnd),
      entry(command('session-capture --mode=session-end --hook-protocol=codex'), 3)
    ],
    PreCompact: [
      ...withoutAgentEntries(existingHooks.hooks?.PreCompact),
      entry(command('session-capture --mode=pre-compact --hook-protocol=codex'), 30)
    ]
  }
};
const hooksText = `${JSON.stringify(hooksDocument, null, 2)}\n`;

type TomlDocument = Record<string, unknown>;

const parseToml = (text: string, label: string): TomlDocument => {
  try {
    return Bun.TOML.parse(text) as TomlDocument;
  } catch (err) {
    throw new Error(`${label} is not valid TOML: ${err instanceof Error ? err.message : String(err)}`);
  }
};
const lookup = (document: TomlDocument, path: string[]): unknown =>
  path.reduce<unknown>(
    (node, key) => (typeof node === 'object' && node !== null ? (node as TomlDocument)[key] : undefined),
    document
  );

/** The key path of a `[table]` / `[[array]]` header line, bare or quoted segments alike; undefined for other lines. */
const headerPath = (line: string): string[] | undefined => {
  const match = /^\s*\[\[?\s*(.+?)\s*\]\]?\s*(?:#.*)?$/.exec(line);
  return match ? [...match[1].matchAll(/"([^"]*)"|'([^']*)'|([^.\s]+)/g)].map((m) => m[1] ?? m[2] ?? m[3]) : undefined;
};
const isAgentTableHeader = (path: string[]): boolean => path[0] === 'mcp_servers' && path[1] === 'kevin';
const withoutAgentTables = (text: string): string => {
  let dropping = false;
  return text
    .split('\n')
    .filter((line) => {
      const path = headerPath(line);
      if (path) dropping = isAgentTableHeader(path);
      return !dropping;
    })
    .join('\n');
};

const tomlString = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const agentTables = [
  '[mcp_servers.kevin]',
  'command = "bun"',
  `args = [${tomlString(resolve(pluginRoot, 'mcp-server', 'src', 'server.ts'))}]`,
  '',
  '[mcp_servers.kevin.env]',
  `AGENT_HOME = ${tomlString(homeDir)}`,
  'PLAYWRIGHT_BROWSERS_PATH = "0"',
  ''
].join('\n');
const existingConfig = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : '';
parseToml(existingConfig, configPath);
const otherConfig = withoutAgentTables(existingConfig)
  .replace(/\n{3,}/g, '\n\n')
  .trim();
if (lookup(parseToml(otherConfig, configPath), ['mcp_servers', 'kevin']) !== undefined) {
  throw new Error(
    `${configPath} registers mcp_servers.kevin in a form this script does not rewrite (inline table or dotted keys); remove it by hand and rerun`
  );
}
const configText = otherConfig ? `${otherConfig}\n\n${agentTables}` : agentTables;
if (lookup(parseToml(configText, 'the generated config'), ['mcp_servers', 'kevin', 'env', 'AGENT_HOME']) !== homeDir) {
  throw new Error(`the generated ${configPath} does not register this home; nothing written`);
}

const writeIfChanged = (path: string, text: string): { path: string; changed: boolean } => {
  const changed = !existsSync(path) || readFileSync(path, 'utf-8') !== text;
  if (changed) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return { path, changed };
};

if (!args.includes('--write')) {
  process.stdout.write(hooksText);
} else {
  const hooks = writeIfChanged(hooksPath, hooksText);
  const mcp = writeIfChanged(configPath, configText);
  process.stdout.write(`${JSON.stringify({ hooks, mcp, entries: 3 })}\n`);
}
