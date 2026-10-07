#!/usr/bin/env bun
/**
 * Upgrade migration for v0.6.1: fifteen skills fold into five playbook skills (briefing, goals,
 * seo, seed, project), and goals gain a day horizon.
 *
 * - Grants: every retired `Skill(agent-kevin:<old>)` in `permissions.allow`, `ask` or `deny` of
 *   `.claude/settings.json` and `.claude/settings.local.json` becomes its successor's grant in the
 *   same list, so an operator who gated `seed-import` is still asked before `seed` runs. A successor
 *   that lands in a stricter list (deny, then ask) is dropped from the looser ones. Every other
 *   entry keeps its place, and the file keeps its layout (indent or compact, line endings).
 * - Cadence: `.kevin/cadence.json` keys move from `weekly-goals` / `monthly-goals` / `yearly-goals`
 *   to `goals-week` / `goals-month` / `goals-year`; when both exist, the later date wins.
 * - TASKS.md: inside the goals markers, a placeholder naming a retired goals skill gets the new
 *   wording, and a `## Daily Goals` placeholder is added when the block has none. Nothing else in
 *   the block changes; the task sections are regenerated on the next task change.
 * - Mentions: files the operator owns that still name an old command are reported, never edited.
 * - Ownership: entries that name this machine (a status line run by absolute path, this plugin's
 *   `enabledPlugins` id and its marketplace, absolute folder grants) move from `settings.json` to
 *   `settings.local.json`, which Claude Code merges back in. Custom-folder rules an older init wrote as `Read(/abs/**)` never matched (a single
 *   slash is project-relative in a rule) and land in their working `//abs` form. The rule lives in
 *   `mcp-server/src/home/settings-scope.ts`.
 *
 * Run by `/agent-kevin:upgrade` via `run_upgrade` (outside the Bash sandbox). Idempotent.
 * Contract: prints a single-line JSON report as its LAST stdout line; exits non-zero on failure.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { FOLDERS, PLUGIN_NAME } from '../../../mcp-server/src/config';
import { type SettleReport, settleSettings } from '../../../mcp-server/src/home/settings-scope';
import { dataDirOf } from '../../../mcp-server/src/shared/naming';
import { migrateGrant, RETIRED_CADENCE_KEYS, RETIRED_SKILLS } from '../../../mcp-server/src/shared/retired-skills';

const VERSION = '0.6.1';
const first = (...values: (string | undefined)[]): string | undefined =>
  values.map((value) => value?.trim()).find((value) => value);

const HOME = resolve(first(process.env.KEVIN_HOME, process.env.AGENT_HOME) ?? process.cwd());
const SETTINGS_FILES = ['settings.json', 'settings.local.json'].map((name) => resolve(HOME, '.claude', name));
const CADENCE = resolve(dataDirOf(HOME), 'cadence.json');
const TASKS = resolve(FOLDERS.PROJECTS, 'TASKS.md');
const GOALS_START = '<!-- GOALS:START -->';
const GOALS_END = '<!-- GOALS:END -->';

const LISTS = ['deny', 'ask', 'allow'] as const;
type List = (typeof LISTS)[number];

const PLACEHOLDERS: Readonly<Record<string, string>> = {
  weekly: '_No weekly goals set yet — run `goals week` to set them._',
  monthly: '_No monthly goals set yet — run `goals month`._',
  yearly: '_No yearly goals set yet — run `goals year` to plan the year by quarters._'
};
// Every wording init and the dashboard ever wrote named the skill as `<horizon>-goals skill`.
const OLD_PLACEHOLDER = /^_No (weekly|monthly|yearly) goals set yet[^\r\n]*-goals skill[^\r\n]*_$/gm;

interface GrantChange {
  file: string;
  list: List;
  from: string;
  to: string[];
}

interface Report {
  ok: true;
  version: string;
  grants: GrantChange[];
  settings: SettleReport;
  cadence: Array<{ from: string; to: string }>;
  tasks: 'updated' | 'unchanged' | 'absent' | 'no-goals-block';
  mentions: Array<{ file: string; commands: string[] }>;
  notes: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const rel = (path: string): string => relative(HOME, path);

const migrated = (entry: unknown): string[] | null =>
  typeof entry === 'string' ? migrateGrant(entry, PLUGIN_NAME) : null;

const migrateSettings = (path: string): GrantChange[] => {
  if (!existsSync(path)) {
    return [];
  }
  const text = readFileSync(path, 'utf-8');
  const settings: unknown = JSON.parse(text);
  if (!isRecord(settings) || !isRecord(settings.permissions)) {
    return [];
  }
  const permissions = settings.permissions;
  const entriesOf = (list: List): unknown[] => (Array.isArray(permissions[list]) ? permissions[list] : []);
  const changes = LISTS.flatMap((list) =>
    entriesOf(list).flatMap((entry) => {
      const to = migrated(entry);
      return typeof entry === 'string' && to ? [{ file: rel(path), list, from: entry, to }] : [];
    })
  );
  if (!changes.length) {
    return [];
  }
  const successors = new Set(changes.flatMap((change) => change.to.filter((grant) => grant !== change.from)));
  const mapped = Object.fromEntries(
    LISTS.map((list) => [list, entriesOf(list).flatMap((entry) => migrated(entry) ?? [entry])])
  ) as Record<List, unknown[]>;
  // A successor keeps its first place in the strictest list that holds it; operator entries stay untouched.
  const rewritten = LISTS.reduce<Partial<Record<List, unknown[]>>>((acc, list, index) => {
    const stricter = new Set(LISTS.slice(0, index).flatMap((tighter) => mapped[tighter]));
    const kept = mapped[list].filter(
      (entry, at) =>
        !(
          typeof entry === 'string' &&
          successors.has(entry) &&
          (stricter.has(entry) || mapped[list].indexOf(entry) < at)
        )
    );
    const original = entriesOf(list);
    const changed = kept.length !== original.length || kept.some((entry, at) => entry !== original[at]);
    return changed ? { ...acc, [list]: kept } : acc;
  }, {});
  // Written back in the file's own shape: compact stays compact, CRLF stays CRLF. JSON.stringify escapes
  // newlines inside strings, so every newline it emits is structural.
  const lead = /^\s*/.exec(text)?.[0] ?? '';
  const body = text.slice(lead.length);
  const indent = /^\{\r?\n([ \t]+)"/.exec(body)?.[1] ?? (/^\{\r?\n/.test(body) ? '  ' : '');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const trailing = /\r?\n$/.test(text) ? eol : '';
  const json = JSON.stringify({ ...settings, permissions: { ...permissions, ...rewritten } }, null, indent);
  writeFileSync(path, `${lead}${json.replaceAll('\n', eol)}${trailing}`);
  return changes;
};

/** A gate on a retired skill now gates every playbook of its successor, not just the old one. */
const widenedNotes = (changes: GrantChange[]): string[] =>
  changes
    .filter((change) => change.list !== 'allow')
    .map((change) => {
      const added = change.to.filter((grant) => grant !== change.from).join(', ');
      return `${change.from} in ${change.list} (${change.file}) gated a retired skill; ${added} there now covers the whole skill that replaced it. Move it if that is broader than you meant.`;
    });

const migrateCadence = (): { moves: Report['cadence']; notes: string[] } => {
  if (!existsSync(CADENCE)) {
    return { moves: [], notes: [] };
  }
  const cadence: unknown = (() => {
    try {
      return JSON.parse(readFileSync(CADENCE, 'utf-8'));
    } catch {
      return null;
    }
  })();
  if (!isRecord(cadence)) {
    return { moves: [], notes: [`${rel(CADENCE)} is not a JSON object, so its goals cadence was left as is.`] };
  }
  const moves = Object.entries(RETIRED_CADENCE_KEYS).filter(([from]) => typeof cadence[from] === 'string');
  if (!moves.length) {
    return { moves: [], notes: [] };
  }
  const later = (current: unknown, incoming: unknown): unknown =>
    typeof current === 'string' && typeof incoming === 'string' && current > incoming ? current : incoming;
  const moved = moves.reduce<Record<string, unknown>>(
    (acc, [from, to]) => ({ ...acc, [to]: later(acc[to], cadence[from]) }),
    Object.fromEntries(Object.entries(cadence).filter(([key]) => !Object.hasOwn(RETIRED_CADENCE_KEYS, key)))
  );
  writeFileSync(CADENCE, `${JSON.stringify(moved, null, 2)}\n`);
  return { moves: moves.map(([from, to]) => ({ from, to })), notes: [] };
};

const migrateTasks = (): Report['tasks'] => {
  if (!existsSync(TASKS)) {
    return 'absent';
  }
  const text = readFileSync(TASKS, 'utf-8');
  const start = text.indexOf(GOALS_START);
  const end = text.indexOf(GOALS_END);
  if (start === -1 || end === -1 || end < start) {
    return 'no-goals-block';
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const block = text.slice(start + GOALS_START.length, end);
  const reworded = block.replace(OLD_PLACEHOLDER, (line, horizon: string) => PLACEHOLDERS[horizon] ?? line);
  const daily = `## Daily Goals${eol}${eol}_No daily goals set yet — run \`goals day\` to set today's._${eol}${eol}`;
  const withDaily = /^## Daily Goals/m.test(reworded) ? reworded : `${eol}${daily}${reworded.replace(/^(\r?\n)+/, '')}`;
  if (withDaily === block) {
    return 'unchanged';
  }
  writeFileSync(TASKS, `${text.slice(0, start + GOALS_START.length)}${withDaily}${text.slice(end)}`);
  return 'updated';
};

// A slash or `$` command, never a URL path (`https://serpapi.com`), a home path (`~/quick-pulse`) or a file name.
const COMMAND = new RegExp(
  `(?:${PLUGIN_NAME}:|(?<![\\w/.~])[/$])(${Object.keys(RETIRED_SKILLS).join('|')})(?![\\w-]|\\.\\w)`,
  'g'
);

// Real files and folders only: a symlinked skill (a skills.sh install) is someone else's, and may dangle.
// The scan only reports, so a folder it can't read is skipped rather than failing the upgrade.
const filesUnder = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? filesUnder(path) : entry.isFile() ? [path] : [];
    });
  } catch {
    return [];
  }
};

const commandsIn = (path: string): string[] => {
  try {
    return [...new Set([...readFileSync(path, 'utf-8').matchAll(COMMAND)].map((match) => match[1] ?? ''))];
  } catch {
    return [];
  }
};

const findMentions = (): Report['mentions'] =>
  [
    ...['skills', 'commands', 'agents', 'rules'].flatMap((dir) => filesUnder(resolve(HOME, '.claude', dir))),
    ...filesUnder(resolve(HOME, '.codex')),
    ...filesUnder(resolve(HOME, 'knowledge', 'user')),
    ...SETTINGS_FILES,
    resolve(HOME, '.claude', 'CLAUDE.md'),
    resolve(HOME, 'AGENTS.md'),
    resolve(HOME, 'CLAUDE.md')
  ]
    .filter((path) => existsSync(path) && /\.(md|json|toml|ya?ml|txt|sh|ts|js|py)$/.test(path))
    .flatMap((path) => {
      const commands = commandsIn(path);
      return commands.length ? [{ file: rel(path), commands }] : [];
    });

try {
  const grants = SETTINGS_FILES.flatMap(migrateSettings);
  const settings = settleSettings(HOME, PLUGIN_NAME, process.env);
  const cadence = migrateCadence();
  const report: Report = {
    ok: true,
    version: VERSION,
    grants,
    settings,
    cadence: cadence.moves,
    tasks: migrateTasks(),
    mentions: findMentions(),
    notes: [...widenedNotes(grants), ...cadence.notes]
  };
  process.stdout.write(JSON.stringify(report) + '\n');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(JSON.stringify({ ok: false, version: VERSION, error: message }) + '\n');
  process.exit(1);
}
