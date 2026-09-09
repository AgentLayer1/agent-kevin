#!/usr/bin/env bun
/**
 * The recommended user-level Codex settings, as a paste-ready note. Codex keeps
 * telemetry, analytics, feedback, terminal, and update keys in `~/.codex/config.toml`
 * only (a project config cannot set them), and the plugin never writes a user-global file
 * on either host, so this prints what is missing and, with `--out`, saves a note the
 * operator can open after the session. Print-only: the operator's files are never edited.
 *
 * Beyond the keys, two files are recommended while absent: a user-level permission profile
 * built from the Claude user settings' `Read(…)` denies (credential stores, `.env` variants),
 * and a rules file that prompts on the shell commands Claude's `permissions.ask` gates.
 * Neither names an agent: they govern every Codex session that is not an agent home, which
 * carries its own generated profile.
 *
 * Usage: codex-user-config.ts --home <dir> [--config <file>] [--claude-settings <file>] [--rules <file>] [--out <file>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};
const home = flag('home');
if (!home) {
  process.stderr.write(
    'usage: codex-user-config.ts --home <dir> [--config <file>] [--claude-settings <file>] [--rules <file>] [--out <file>]\n'
  );
  process.exit(2);
}
const configPath = flag('config') ?? resolve(homedir(), '.codex', 'config.toml');
const claudeSettingsPath = flag('claude-settings') ?? resolve(homedir(), '.claude', 'settings.json');
const rulesPath = flag('rules') ?? resolve(homedir(), '.codex', 'rules', 'default.rules');

type Toml = Record<string, unknown>;
const isRecord = (value: unknown): value is Toml => typeof value === 'object' && value !== null;
let unreadable: string | undefined;
const readToml = (path: string): Toml => {
  if (!existsSync(path)) return {};
  try {
    return Bun.TOML.parse(readFileSync(path, 'utf-8')) as Toml;
  } catch (err) {
    unreadable = err instanceof Error ? err.message : String(err);
    return {};
  }
};
const readJson = (path: string): Toml => {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  return isRecord(parsed) ? parsed : {};
};
const lookup = (document: Toml, path: string[]): unknown =>
  path.reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), document);

const claudeUser = readJson(claudeSettingsPath) as {
  effortLevel?: unknown;
  permissions?: { deny?: unknown; ask?: unknown };
};
const claudeList = (key: 'deny' | 'ask'): string[] => {
  const list = claudeUser.permissions?.[key];
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
};

/** Claude's effort levels mapped onto Codex's reasoning efforts; absent when the operator set none. */
const EFFORT: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', max: 'xhigh' };
const claudeEffort = claudeUser.effortLevel;
const reasoningEffort = typeof claudeEffort === 'string' ? EFFORT[claudeEffort] : undefined;

interface Recommendation {
  path: string[];
  value: string | boolean;
  why: string;
}
const recommendations: Recommendation[] = [
  ...(reasoningEffort
    ? [
        {
          path: ['model_reasoning_effort'],
          value: reasoningEffort,
          why: `matches effortLevel "${String(claudeEffort)}" in your Claude settings`
        }
      ]
    : []),
  { path: ['approval_policy'], value: 'on-request', why: 'prompts only when a rule or a boundary asks for one' },
  {
    path: ['approvals_reviewer'],
    value: 'user',
    why: 'a human answers the outbound prompts, as the Claude ask list does'
  },
  { path: ['check_for_update_on_startup'], value: true, why: 'a stale Codex is a stale plugin host' },
  {
    path: ['analytics', 'enabled'],
    value: false,
    why: 'usage analytics off, the Claude home disables nonessential traffic too'
  },
  { path: ['feedback', 'enabled'], value: false, why: 'no transcript submission through /feedback' },
  { path: ['otel', 'exporter'], value: 'none', why: 'no log export' },
  { path: ['otel', 'metrics_exporter'], value: 'none', why: 'no metrics export' },
  { path: ['otel', 'trace_exporter'], value: 'none', why: 'no trace export' },
  { path: ['otel', 'log_user_prompt'], value: false, why: 'prompts never leave the machine as telemetry' },
  { path: ['tui', 'animations'], value: false, why: 'no shimmer or spinner redraws, the Claude home sets no-flicker' },
  { path: ['tui', 'alternate_screen'], value: 'never', why: 'keep the scrollback so earlier output stays selectable' }
];

const config = readToml(configPath);
const missing = recommendations.filter((item) => lookup(config, item.path) !== item.value);
const tomlValue = (value: string | boolean): string =>
  typeof value === 'string' ? JSON.stringify(value) : String(value);
const block = (): string => {
  const top = missing
    .filter((item) => item.path.length === 1)
    .map((item) => `${item.path[0]} = ${tomlValue(item.value)}`);
  const tables = [...new Set(missing.filter((item) => item.path.length === 2).map((item) => item.path[0]))].map(
    (table) =>
      [
        // TOML refuses a second [table] header: an existing table takes the keys inside it.
        isRecord(config[table]) ? `# inside your existing [${table}] table:` : `[${table}]`,
        ...missing
          .filter((item) => item.path[0] === table && item.path.length === 2)
          .map((item) => `${item.path[1]} = ${tomlValue(item.value)}`)
      ].join('\n')
  );
  return [...(top.length ? [top.join('\n')] : []), ...tables].join('\n\n');
};

/** Claude `Read(…)` denies as Codex globs: `~/x` stays literal (Codex expands it), `//x` is absolute, the rest is workspace-relative. */
const denyGlobs = claudeList('deny')
  .map((pattern) => /^Read\((.+)\)$/.exec(pattern)?.[1] ?? '')
  .filter(Boolean)
  .map((glob) => (glob.startsWith('//') ? glob.slice(1) : glob));
const isAbsolute = (glob: string): boolean => glob.startsWith('/') || glob.startsWith('~/');
const absoluteDenies = [...new Set(denyGlobs.filter(isAbsolute))];
const relativeDenies = [...new Set(['**/*.env', '**/.env.*', ...denyGlobs.filter((glob) => !isAbsolute(glob))])];
const profileBlock =
  'default_permissions' in config
    ? ''
    : [
        'default_permissions = "everyday"',
        '',
        '[permissions.everyday]',
        'description = "Everyday projects: write the workspace, commit, reach the network, never read credentials"',
        'extends = ":workspace"',
        '',
        '[permissions.everyday.filesystem]',
        ...absoluteDenies.map((glob) => `${JSON.stringify(glob)} = "deny"`),
        '',
        '[permissions.everyday.filesystem.":workspace_roots"]',
        '".git" = "write"',
        ...relativeDenies.map((glob) => `${JSON.stringify(glob)} = "deny"`),
        '',
        '[permissions.everyday.network]',
        'enabled = true'
      ].join('\n');

const askPrefixes = [
  ...new Set(
    claudeList('ask')
      .map((pattern) => /^Bash\((.+)\)$/.exec(pattern)?.[1] ?? '')
      .map((body) => body.replace(/\s*:?\*$/, '').trim())
      .filter((body) => body && !/[*?[\]{}]/.test(body))
  )
];
const rule = (prefix: string): string =>
  [
    'prefix_rule(',
    `    pattern = [${prefix
      .split(/\s+/)
      .map((word) => JSON.stringify(word))
      .join(', ')}],`,
    '    decision = "prompt",',
    `    justification = ${JSON.stringify(`${prefix} waits for me`)},`,
    ')'
  ].join('\n');
const rulesBlock = existsSync(rulesPath) || askPrefixes.length === 0 ? '' : askPrefixes.map(rule).join('\n\n');

const status = unreadable
  ? 'unreadable'
  : missing.length === 0 && !profileBlock && !rulesBlock
    ? 'current'
    : Object.keys(config).length === 0
      ? 'absent'
      : 'partial';
const report = {
  status,
  configPath,
  unreadable: unreadable ?? null,
  missing: missing.map((item) => ({ key: item.path.join('.'), value: item.value, why: item.why })),
  block: block(),
  profileBlock,
  rulesPath,
  rulesBlock,
  optIn:
    '# approvals_reviewer = "auto_review"   # let a reviewer model answer prompts instead of you; on this plugin\'s tests it denied named pushes and local commits, so it stays opt-in'
};

const note = (): string => {
  const lines = [
    `# Codex user settings for ${home}`,
    '',
    `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by the plugin. The plugin never edits`,
    `\`${configPath}\` or \`${rulesPath}\`; every line below is yours to paste. These keys are user-level only:`,
    'Codex ignores telemetry, notification, and provider keys in a project config, so the home cannot carry them.',
    ''
  ];
  if (status === 'unreadable') {
    lines.push(`**Status: unreadable.** \`${configPath}\` did not parse (${unreadable}); fix it first, then rerun.`);
  } else if (missing.length === 0) {
    lines.push('**Keys: current.** Every recommended key is already set.');
  } else {
    lines.push(
      `**Keys: ${missing.length} of ${recommendations.length} recommended keys are missing or differ.**`,
      'Top-level keys go above the first `[table]` in the file. A table you already have is marked below: put',
      'those keys inside it, since TOML refuses a second header for the same table.',
      '',
      '```toml',
      report.block,
      '```',
      '',
      '| Key | Why |',
      '|---|---|',
      ...missing.map((item) => `| \`${item.path.join('.')}\` | ${item.why} |`)
    );
  }
  if (profileBlock) {
    lines.push(
      '',
      '## A user-level permission profile',
      '',
      `No \`default_permissions\` in \`${configPath}\`. This profile, built from the Read denies in your Claude user`,
      'settings, gives every non-agent Codex session the same posture: credentials and `.env` files refused by',
      'policy, commits routine, network on. Agent homes keep their own generated profile. The first line goes',
      'above your first `[table]`:',
      '',
      '```toml',
      profileBlock,
      '```'
    );
  }
  if (rulesBlock) {
    lines.push(
      '',
      '## A user-level rules file',
      '',
      `No \`${rulesPath}\`. These rules, built from the \`Bash(…)\` entries in your Claude user settings' ask list,`,
      'prompt you before the same commands in every project; Codex loads every file in that directory and takes',
      'the strictest decision:',
      '',
      '```',
      rulesBlock,
      '```'
    );
  }
  lines.push(
    '',
    '## Opt-in',
    '',
    'Not recommended by default; add it if you want prompts answered by a reviewer model:',
    '',
    '```toml',
    report.optIn,
    '```',
    ''
  );
  return lines.join('\n');
};

const out = flag('out');
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, note());
}
process.stdout.write(`${JSON.stringify({ ...report, notePath: out ?? null }, null, 2)}\n`);
