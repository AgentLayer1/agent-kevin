#!/usr/bin/env bun
/**
 * The per-home Codex wiring: hooks in `<home>/.codex/hooks.json` (the SessionStart
 * context with Codex's per-hook output cap lifted, the SessionEnd capture, the
 * PreCompact capture that saves a long session before Codex compacts it, and the
 * PreToolUse guard against home trees written relative to a drifted cwd), the agent's MCP
 * server plus its permission posture in `<home>/.codex/config.toml`, and the command rules
 * in `<home>/.codex/rules/<agent>.rules`, every command pointing at this plugin checkout
 * and this home. Codex has no `@-import`, and a plugin cannot bundle hooks or an MCP
 * server that knows which home it serves (the server is launched inside the plugin
 * cache, with no workspace variable and no MCP roots), so init and upgrade write these
 * files. The posture is read from the home's Claude settings so the two hosts never
 * drift: the runtime secrets store is denied, the code path and additional directories
 * become workspace roots with `.git` writable, and every `permissions.ask` shell pattern
 * becomes a rule that prompts. Only the agent's own entries and tables are replaced: the
 * operator's other hooks, MCP servers, rules files, and settings survive; a file that does
 * not parse, or one whose other settings would not survive the rewrite in meaning, is left
 * alone. The hook commands carry the home as a `--home=` argument rather than an env
 * prefix, double-quoted, so the same line parses under sh and under the PowerShell Codex
 * uses on Windows.
 *
 * Usage: codex-setup.ts --home <dir> [--plugin-root <dir>] [--write] [--claude-user-settings <file>] [--codex-user-config <file>]
 *   Prints the merged hooks document. With --write it writes the files whose content
 *   differs and prints `{ hooks, mcp, rules, entries, profile, notes }`, each file as
 *   `{ path, changed }`, so the caller knows a hook re-trust is due.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

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
type TomlDocument = Record<string, unknown>;

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
const homeDir = resolve(home);
const pluginRoot = resolve(flag('plugin-root') ?? resolve(import.meta.dir, '..', '..', '..'));
const claudeUserSettingsPath = flag('claude-user-settings') ?? resolve(homedir(), '.claude', 'settings.json');
const userConfigPath = flag('codex-user-config') ?? resolve(homedir(), '.codex', 'config.toml');
const hooksPath = resolve(homeDir, '.codex', 'hooks.json');
const configPath = resolve(homeDir, '.codex', 'config.toml');

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const readJson = (path: string): Record<string, unknown> => {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  return isRecord(parsed) ? parsed : {};
};
const expandTilde = (path: string): string => path.replace(/^~(?=$|\/)/, homedir());

/** The agent's names, from the manifest of the checkout being wired, else this one. */
const manifestPath = [pluginRoot, resolve(import.meta.dir, '..', '..', '..')]
  .map((root) => resolve(root, '.claude-plugin', 'plugin.json'))
  .find((path) => existsSync(path));
const pluginName = String(readJson(String(manifestPath)).name ?? '');
const agent = pluginName.replace(/^agent-/, '');
if (!agent) {
  throw new Error(`${manifestPath}: the plugin manifest names no agent`);
}
const envPrefix = `${agent.toUpperCase()}_`;
const rulesPath = resolve(homeDir, '.codex', 'rules', `${agent}.rules`);

// ── The home's Claude settings: the posture's source of truth ─────────────────
interface ClaudeSettings {
  env?: Record<string, unknown>;
  permissions?: { ask?: unknown; deny?: unknown; additionalDirectories?: unknown };
}
const claudeSettings = ['settings.json', 'settings.local.json'].map(
  (file) => readJson(resolve(homeDir, '.claude', file)) as ClaudeSettings
);
const settingsEnv: Record<string, string> = Object.fromEntries(
  claudeSettings.flatMap((settings) =>
    Object.entries(settings.env ?? {}).filter((pair): pair is [string, string] => typeof pair[1] === 'string')
  )
);
const settingValue = (key: string): string | undefined =>
  settingsEnv[`${envPrefix}${key}`] ?? settingsEnv[`AGENT_${key}`];
const settingList = (key: keyof NonNullable<ClaudeSettings['permissions']>): string[] =>
  claudeSettings.flatMap((settings) => {
    const list = settings.permissions?.[key];
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
  });
const runtimeDir = settingValue('RUNTIME_DIR') ?? `.${agent}`;
const secretsDir = resolve(homeDir, runtimeDir, 'secrets');

/** Directories the agent works in outside the home, in the order the settings name them. */
const insideHome = (path: string): boolean => {
  const fromHome = relative(homeDir, path);
  return fromHome === '' || (!fromHome.startsWith('..') && !isAbsolute(fromHome));
};
const workspaceRoots = [
  ...new Set(
    [
      settingValue('CODE_PATH') ?? '',
      ...(settingValue('GIT_REPOS') ?? '').split(','),
      ...settingList('additionalDirectories'),
      ...['KNOWLEDGE', 'PROJECTS', 'REPORTS'].map((key) => settingValue(key) ?? '')
    ]
      .map((path) => path.trim())
      .filter(Boolean)
      .map((path) => resolve(homeDir, expandTilde(path)))
  )
].filter((path) => !insideHome(path));

/** Claude `Read(…)` denies as Codex deny globs: `//x` is filesystem-absolute, `~/x` the user's home, anything else a workspace-relative pattern. */
const denyGlobs = (patterns: string[]): string[] => [
  ...new Set(
    patterns
      .map((pattern) => /^Read\((.+)\)$/.exec(pattern)?.[1] ?? '')
      .filter(Boolean)
      .map((glob) => (glob.startsWith('//') ? glob.slice(1) : glob.startsWith('~/') ? expandTilde(glob) : glob))
  )
];
const readDenies = denyGlobs(settingList('deny'));

/** `permissions.ask` shell patterns as rule prefixes: `Bash(git push *)` → `git push`. MCP tool asks have no rule form. */
const askPrefixes = [
  ...new Set(
    settingList('ask')
      .map((pattern) => /^Bash\((.+)\)$/.exec(pattern)?.[1] ?? '')
      .map((body) => body.replace(/\s*:?\*$/, '').trim())
      .filter((body) => body && !/[*?[\]{}]/.test(body))
  )
];

// ── Hooks ────────────────────────────────────────────────────────────────────
/** A hook command of ours, whichever checkout (quoted or not) it points at. */
const AGENT_COMMAND = new RegExp(`bin[\\\\/]${agent}["']? (session-(start|capture)|guard) .*--hook-protocol=codex`);
/** Double quotes are the one quoting sh and PowerShell agree on; a path either shell would expand inside them is refused. */
const quote = (value: string): string => {
  if (/["$`]/.test(value)) {
    throw new Error(`${value}: a path in a hook command may not contain ", $, or a backtick`);
  }
  return `"${value}"`;
};
const command = (rest: string): string =>
  `bun ${quote(resolve(pluginRoot, 'bin', agent))} ${rest} --home=${quote(homeDir)}`;
const entry = (commandLine: string, timeout: number, extra: Partial<HookItem> = {}, matcher = ''): HookGroup => ({
  matcher,
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
  if (!isRecord(parsed) || Array.isArray(parsed)) {
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
      // Codex clamps a SessionEnd hook to 3 seconds whatever the entry says.
      entry(command('session-capture --mode=session-end --hook-protocol=codex'), 3)
    ],
    PreCompact: [
      ...withoutAgentEntries(existingHooks.hooks?.PreCompact),
      entry(command('session-capture --mode=pre-compact --hook-protocol=codex'), 30)
    ],
    // Codex presents shell commands, unified exec included, to hooks as tool name Bash, the Claude Code shape.
    PreToolUse: [
      ...withoutAgentEntries(existingHooks.hooks?.PreToolUse),
      entry(command('guard --hook-protocol=codex'), 5, {}, 'Bash')
    ]
  }
};
const hooksText = `${JSON.stringify(hooksDocument, null, 2)}\n`;

// ── config.toml ──────────────────────────────────────────────────────────────
const parseToml = (text: string, label: string): TomlDocument => {
  try {
    return Bun.TOML.parse(text) as TomlDocument;
  } catch (err) {
    throw new Error(`${label} is not valid TOML: ${err instanceof Error ? err.message : String(err)}`);
  }
};
const lookup = (document: TomlDocument, path: string[]): unknown =>
  path.reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), document);

/** The key path of a `[table]` / `[[array]]` header line, bare or quoted segments alike; undefined for other lines. */
const headerPath = (line: string): string[] | undefined => {
  const match = /^\s*\[\[?\s*(.+?)\s*\]\]?\s*(?:#.*)?$/.exec(line);
  return match ? [...match[1].matchAll(/"([^"]*)"|'([^']*)'|([^.\s]+)/g)].map((m) => m[1] ?? m[2] ?? m[3]) : undefined;
};
/** The tables this script owns outright; everything under them is regenerated. */
const OWNED_TABLES: string[][] = [['mcp_servers', agent], ['permissions', agent], ['shell_environment_policy']];
/** The top-level keys it sets when absent; an operator's own value is kept. */
const OWNED_KEYS: Record<string, string> = {
  default_permissions: agent,
  approval_policy: 'on-request',
  approvals_reviewer: 'user'
};
const isOwnedHeader = (path: string[]): boolean =>
  OWNED_TABLES.some((owned) => owned.every((segment, index) => path[index] === segment));
/** Drop the owned tables with the blank lines that separated them, leaving every other line untouched. */
const withoutOwnedTables = (text: string): string => {
  const kept: string[] = [];
  let dropping = false;
  for (const line of text.split('\n')) {
    const path = headerPath(line);
    if (path) {
      const wasDropping = dropping;
      dropping = isOwnedHeader(path);
      if (dropping) {
        while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
      } else if (wasDropping && kept.length > 0 && kept[kept.length - 1].trim() !== '') {
        kept.push('');
      }
    }
    if (!dropping) kept.push(line);
  }
  return kept.join('\n');
};

const tomlString = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const tomlScalar = (key: string, value: unknown): string => {
  const name = /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
  if (typeof value === 'string') return `${name} = ${tomlString(value)}`;
  if (typeof value === 'number' || typeof value === 'boolean') return `${name} = ${String(value)}`;
  if (Array.isArray(value) && value.every((item): item is string => typeof item === 'string')) {
    return `${name} = [${value.map(tomlString).join(', ')}]`;
  }
  throw new Error(
    `${configPath}: ${key} carries a value this script cannot rewrite; move it out of the agent's tables and rerun`
  );
};
// What Claude denies for every project at user level, minus what the operator's user-level Codex
// profile already denies: the rest lands in this home's profile, so a home is covered either way
// and the user-level file stays the operator's own.
const userTables = existsSync(userConfigPath) ? parseToml(readFileSync(userConfigPath, 'utf-8'), userConfigPath) : {};
const userProfile = lookup(userTables, ['permissions', String(userTables.default_permissions ?? '')]) as
  | Record<string, unknown>
  | undefined;
const userFilesystem = (userProfile?.filesystem as Record<string, unknown> | undefined) ?? {};
const userDenied = new Set(
  [
    ...Object.entries(userFilesystem),
    ...Object.entries((userFilesystem[':workspace_roots'] as Record<string, unknown> | undefined) ?? {})
  ]
    .filter(([, access]) => access === 'deny')
    .map(([glob]) => expandTilde(glob))
);
const userClaude = readJson(claudeUserSettingsPath) as ClaudeSettings;
const userClaudeDenyList = Array.isArray(userClaude.permissions?.deny)
  ? userClaude.permissions.deny.filter((item): item is string => typeof item === 'string')
  : [];
const inheritedDenies = denyGlobs(userClaudeDenyList).filter((glob) => !userDenied.has(glob));
const absoluteDenies = [...new Set([...readDenies, ...inheritedDenies])].filter((glob) => glob.startsWith('/'));
const relativeDenies = [...new Set([...readDenies, ...inheritedDenies])].filter((glob) => !glob.startsWith('/'));
const existingConfig = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : '';
const existingTables = parseToml(existingConfig, configPath);
const legacySandboxKeys = ['sandbox_mode', 'sandbox_workspace_write'].filter((key) => key in existingTables);
if (legacySandboxKeys.length > 0) {
  throw new Error(
    `${configPath} sets ${legacySandboxKeys.join(' and ')}, which Codex does not combine with a permission profile; remove them (the profile carries the sandbox) and rerun`
  );
}
/** Whatever the operator added to the agent's own tables (a startup timeout, an extra env var) survives regeneration. */
const keptEntries = (path: string[], own: string[]): string[] =>
  Object.entries((lookup(existingTables, path) as Record<string, unknown> | undefined) ?? {})
    .filter(([key]) => !own.includes(key))
    .map(([key, value]) => tomlScalar(key, value));

/** The agent's own env for the model's shell: the two home spellings plus the home's `AGENT_*` / prefixed settings, never a credential. */
const shellEnv: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(settingsEnv).filter(
      ([key]) => (key.startsWith('AGENT_') || key.startsWith(envPrefix)) && !/KEY|SECRET|TOKEN|PASSWORD/i.test(key)
    )
  ),
  AGENT_HOME: homeDir,
  [`${envPrefix}HOME`]: homeDir
};
const existingSet =
  (lookup(existingTables, ['shell_environment_policy', 'set']) as Record<string, unknown> | undefined) ?? {};
const mergedSet: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(existingSet).filter(
      (pair): pair is [string, string] =>
        typeof pair[1] === 'string' && !pair[0].startsWith('AGENT_') && !pair[0].startsWith(envPrefix)
    )
  ),
  ...shellEnv
};
const inlineTable = (entries: Record<string, string>): string =>
  `{ ${Object.entries(entries)
    .map(([key, value]) => `${/^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key)} = ${tomlString(value)}`)
    .join(', ')} }`;

const agentTables = [
  `[mcp_servers.${agent}]`,
  'command = "bun"',
  `args = [${tomlString(resolve(pluginRoot, 'mcp-server', 'src', 'server.ts'))}]`,
  ...keptEntries(['mcp_servers', agent], ['command', 'args', 'env']),
  '',
  `[mcp_servers.${agent}.env]`,
  `AGENT_HOME = ${tomlString(homeDir)}`,
  `${envPrefix}HOME = ${tomlString(homeDir)}`,
  'PLAYWRIGHT_BROWSERS_PATH = "0"',
  ...keptEntries(['mcp_servers', agent, 'env'], ['AGENT_HOME', `${envPrefix}HOME`, 'PLAYWRIGHT_BROWSERS_PATH']),
  '',
  // The posture: write the home and its repos, commit in them, reach the network, never read the
  // secrets store. An approved escalation does not lift a profile (verified on 0.153), so every
  // writable root and the network have to be granted here or they are unreachable.
  `[permissions.${agent}]`,
  `description = ${tomlString(`${agent} home: write the home and its repos, commit in them, never read the secrets store`)}`,
  'extends = ":workspace"',
  '',
  `[permissions.${agent}.filesystem]`,
  `${tomlString(secretsDir)} = "deny"`,
  ...absoluteDenies.map((glob) => `${tomlString(glob)} = "deny"`),
  '',
  `[permissions.${agent}.filesystem.":workspace_roots"]`,
  '".git" = "write"',
  `${tomlString(`**/${runtimeDir}/secrets/**`)} = "deny"`,
  ...[...new Set(['**/*.env', '**/.env.*', ...relativeDenies])].map((glob) => `${tomlString(glob)} = "deny"`),
  '',
  `[permissions.${agent}.network]`,
  'enabled = true',
  ...(workspaceRoots.length > 0
    ? ['', `[permissions.${agent}.workspace_roots]`, ...workspaceRoots.map((root) => `${tomlString(root)} = true`)]
    : []),
  '',
  '[shell_environment_policy]',
  ...keptEntries(['shell_environment_policy'], ['set']),
  `set = ${inlineTable(mergedSet)}`,
  ''
].join('\n');

const otherConfig = withoutOwnedTables(existingConfig).trim();
for (const owned of OWNED_TABLES) {
  if (lookup(parseToml(otherConfig, configPath), owned) !== undefined) {
    throw new Error(
      `${configPath} defines ${owned.join('.')} in a form this script does not rewrite (inline table or dotted keys); remove it by hand and rerun`
    );
  }
}
const missingKeys = Object.entries(OWNED_KEYS).filter(([key]) => !(key in existingTables));
// Top-level keys must precede the first table, or TOML files them under whatever table came last.
const topKeys = missingKeys.map(([key, value]) => `${key} = ${tomlString(value)}`).join('\n');
const configText = [topKeys, otherConfig, agentTables].filter(Boolean).join('\n\n');
const generatedTables = parseToml(configText, 'the generated config');
if (lookup(generatedTables, ['mcp_servers', agent, 'env', 'AGENT_HOME']) !== homeDir) {
  throw new Error(`the generated ${configPath} does not register this home; nothing written`);
}
/** Everything this script does not own, for the equality check. */
const withoutOwn = (document: TomlDocument): TomlDocument => {
  const rest: TomlDocument = { ...document };
  for (const key of Object.keys(OWNED_KEYS)) delete rest[key];
  for (const [table, name] of OWNED_TABLES) {
    if (name === undefined) {
      delete rest[table];
      continue;
    }
    const inner = { ...((rest[table] as TomlDocument | undefined) ?? {}) };
    delete inner[name];
    if (Object.keys(inner).length > 0) rest[table] = inner;
    else delete rest[table];
  }
  return rest;
};
if (JSON.stringify(withoutOwn(existingTables)) !== JSON.stringify(withoutOwn(generatedTables))) {
  throw new Error(`${configPath}: rewriting it would change a setting outside the agent's own tables; nothing written`);
}
const userSandboxKeys = ['sandbox_mode', 'sandbox_workspace_write', 'default_permissions'].filter(
  (key) => key in userTables
);
const notes = [
  ...(userSandboxKeys.length > 0
    ? [
        `${userConfigPath} sets ${userSandboxKeys.join(' and ')}; this home's profile overrides it for sessions started here, and Codex does not combine sandbox_mode with a profile`
      ]
    : []),
  ...Object.entries(OWNED_KEYS)
    .filter(([key, value]) => key in existingTables && existingTables[key] !== value)
    .map(
      ([key, value]) =>
        `${key} is ${JSON.stringify(existingTables[key])} in ${configPath}; the recommended value is "${value}" and yours was kept`
    )
];

// ── rules ────────────────────────────────────────────────────────────────────
const rule = (words: string[]): string =>
  [
    'prefix_rule(',
    `    pattern = [${words.map((word) => JSON.stringify(word)).join(', ')}],`,
    '    decision = "prompt",',
    `    justification = ${JSON.stringify(`${words.join(' ')} waits for the operator, as it does under Claude Code`)},`,
    ')'
  ].join('\n');
const rulesText =
  [
    `# Generated by the ${pluginName} plugin from this home's Claude permissions.ask; regenerated by init and upgrade.`,
    '# Your own rules belong in another file in this directory: Codex loads every .rules file here.',
    ...askPrefixes.map((prefix) => rule(prefix.split(/\s+/)))
  ].join('\n\n') + '\n';

// ── write ────────────────────────────────────────────────────────────────────
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
  // The server first: hooks that outlive a failed config write would point at nothing.
  const mcp = writeIfChanged(configPath, configText);
  const rules = writeIfChanged(rulesPath, rulesText);
  const hooks = writeIfChanged(hooksPath, hooksText);
  const profile = { name: agent, workspaceRoots, rules: askPrefixes };
  process.stdout.write(`${JSON.stringify({ hooks, mcp, rules, entries: 4, profile, notes })}\n`);
}
