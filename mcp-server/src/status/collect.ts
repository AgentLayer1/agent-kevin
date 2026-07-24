/**
 * Status snapshot collector.
 *
 * Reads every surface that makes up "what Kevin is right now" — skills, MCP
 * tools, hooks, knowledge wiki, compile state, tasks, loaded context, layered
 * settings, logs — and returns a typed snapshot. Every read is best-effort:
 * a missing or malformed source degrades to a sentinel, never throws, so the
 * screen renders on a half-initialized HOME.
 *
 * Paths in: always via FOLDERS/FILES (@/config). Paths out: callers render
 * through repoRelative()/tildify so absolute machine paths never leak.
 */
import { FILES, FOLDERS, listSecretEntries, MARKDOWN_URL, PLUGIN_NAME, type SecretEntry, TIMEZONE } from '@/config';
import { contextManifest, type ManifestEntry } from '@/context';
import { type ChangelogEntry, getUpgradeStatus, parseChangelog, type UpgradeState } from '@/version';
import { nowISO, nowTime, offsetFor, todayDate } from '@/shared/date';
import { env } from '@/shared/env';
import {
  composeMetaBox,
  composeMetaRows,
  conversationTextFromLines,
  extractSessionRefs,
  type RadarTaskRef
} from './radar-refs';
import { sanitizeHtml } from '@/shared/sanitize-html';
import type { TaskFile } from '@/shared/types';
import { discoverProjects, scanAllTasks, scanArchivedTasks } from '@/tasks/scan';
import { resolveTasks } from '@/tasks/resolve';
import { TOOL_MODULES } from '@/tools/modules';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { relative, resolve } from 'node:path';

export interface SettingsLayer {
  label: string;
  path: string;
  present: boolean;
  allow: number;
  deny: number;
  envCount: number;
}

export interface EnvEntry {
  key: string;
  value: string;
  scope: 'user' | 'workspace';
}

export interface PluginRef {
  ref: string;
  marketplace: string;
  sourceType: string;
  sourcePath: string;
}

export interface FacetSize {
  name: string;
  bytes: number;
}

export interface ReportRef {
  /** ISO day the report was filed under in reports/index.md. */
  date: string;
  time: string;
  title: string;
  /** Path relative to <HOME> (e.g. `reports/briefings/...md`); '' if unparsed. */
  href: string;
  skill: string;
  /** Status emoji from the index line (🟢/🟠/🔴/⏳); '' if absent. */
  status: string;
  /** Category derived from the href path: `briefings` | `plans` | `radar` | `permissions` | ''. */
  category: string;
}

/** The most recent radar (where-am-i) digest, pre-rendered to HTML for the
 *  Sessions page Radar tab. Null when no radar report exists yet. */
export interface RadarLatest {
  date: string;
  time: string;
  title: string;
  /** HOME-relative path to the source report, e.g. `reports/radar/…md`. */
  href: string;
  /** Report body (frontmatter + trailing stats footer stripped) rendered to
   *  HTML via marked. */
  html: string;
  /** The digest's "N sessions · window · scope" stats line, lifted out of the
   *  body so the dashboard can render it below the footer divider. */
  footer?: string;
  /** Structured per-session rows parsed from the digest body — drives the
   *  Today page's Ongoing feed (time-ago + title, expanding to summary + resume). */
  sessions: RadarSession[];
}

/** One session block parsed out of a radar digest. */
export interface RadarSession {
  title: string;
  /** Relative recency as the digest phrased it, e.g. `10m ago`, `~16h ago`. */
  timeAgo: string;
  summary: string;
  /** `claude --resume <id>` command, or '' when the digest omitted one. */
  resume: string;
  /** Related tasks + plans as raw HTML `.rmeta-row` divs; '' when none. */
  meta: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  custom: boolean;
  /** True when the model may auto-invoke it (no `disable-model-invocation`). */
  auto: boolean;
}

export interface DbConnectionInfo {
  name: string;
  host: string;
  port: string;
  database: string;
}

export interface ToolInfo {
  name: string;
  description: string;
  /** Configured DB connections — set on the `db_*` tools; drives the dashboard chip + modal. */
  dbConnections?: DbConnectionInfo[];
}

/** One captured working session from raw/sessions/index.json. */
export interface SessionRef {
  id: string;
  /** Day the session started — when it predates lastSeen, the session was
   *  resumed and its briefing describes that older start. */
  firstSeen: string;
  lastSeen: string;
  /** HH:MM of the latest captured block (harvested from the last two
   *  day-files); '' for older sessions. */
  time: string;
  turns: number;
  cwd: string;
  briefing: string;
  /** True when the session opened with a slash command / skill invocation. */
  isCommand: boolean;
}

/** A news headline harvested from a recent briefing report. */
export interface NewsItem {
  /** Briefing day (from the report filename). */
  date: string;
  title: string;
  /** '' when the briefing carried the headline without a link. */
  url: string;
  /** `(Source, Mon D)` annotation following the headline; '' if absent. */
  source: string;
}

export interface LintIssue {
  severity: string;
  text: string;
}

/** Parsed .kevin/lint.md — the last knowledge_lint run. */
export interface LintReport {
  date: string;
  errors: number;
  warnings: number;
  suggestions: number;
  issues: LintIssue[];
  present: boolean;
}

export interface CliEntry {
  cmd: string;
  desc: string;
}

/** One section of the bin CLI HELP text. */
export interface CliSection {
  section: string;
  entries: CliEntry[];
}

/** Kevin's rendered identity — parsed best-effort from IDENTITY.md + SOUL.md. */
export interface Persona {
  name: string;
  kind: string;
  vibe: string;
  emoji: string;
  /** Avatar path relative to <HOME>; '' when the file doesn't exist. */
  avatar: string;
  bio: string;
  /** Every `## Section` of IDENTITY.md except the ones the header already shows. */
  identitySections: ProfileSection[];
  /** Every `## Section` of SOUL.md as stripped text lines. */
  soulSections: ProfileSection[];
}

export interface FacetInfo {
  name: string;
  description: string;
  bytes: number;
  href: string;
}

export interface ProfileSection {
  title: string;
  lines: string[];
}

/** The operator as Kevin knows them — USER.md headline + facet catalog +
 *  the compiled profile facet rendered into sections. */
export interface OperatorInfo {
  name: string;
  timezone: string;
  /** Avatar path relative to <HOME>; '' when the file doesn't exist. */
  avatar: string;
  /** First paragraph of knowledge/user/profile.md; '' when absent. */
  headline: string;
  /** `## Section` blocks of knowledge/user/profile.md, markdown stripped. */
  profileSections: ProfileSection[];
  facets: FacetInfo[];
}

export interface ConceptInfo {
  name: string;
  description: string;
  href: string;
}

export interface Health {
  overdue: number;
  pendingCompiles: number;
  logErrors: number;
  missingImports: number;
  ok: boolean;
}

export type ContextGroup = 'instructions' | 'identity' | 'facets' | 'knowledge' | 'tasks' | 'other';

export interface SessionDay {
  label: string;
  bytes: number;
}

export interface StaticImport {
  label: string;
  bytes: number;
  present: boolean;
  group: ContextGroup;
  /** Which CLAUDE.md layer this instruction source comes from, when relevant —
   *  user (`~/.claude`), project (HOME), or local (`CLAUDE.local.md`). */
  level?: 'user' | 'project' | 'local';
}

/** A path-scoped coding rule from a `.claude/rules/*.md` file — Claude Code
 *  auto-applies it to files matching the frontmatter `paths` globs. Collected
 *  from both the user (`~/.claude/rules`) and project (`<HOME>/.claude/rules`)
 *  layers for the Brain › Context view. */
export interface RuleEntry {
  /** Filename without the `.md` extension, e.g. `typescript`. */
  name: string;
  level: 'user' | 'project';
  /** Glob patterns from the frontmatter `paths:` list; empty when unscoped. */
  paths: string[];
  bytes: number;
  /** HOME-relative path for project rules (clickable); absolute for user. */
  path: string;
}

export interface ProjectLoad {
  project: string;
  open: number;
  active: number;
  blocked: number;
  /** Open + active + blocked — the live working set. */
  total: number;
  /** Done/cancelled tasks: still-in-place ones plus the archive folder. */
  done: number;
  /** Most recent `updated:` across the project's live tasks; '' if none. */
  updatedAt: string;
  /** First paragraph of the project README, markdown stripped; '' if none. */
  description: string;
}

export interface TaskRef {
  id: string;
  title: string;
  priority: string;
  project: string;
  status: string;
  due: string;
  updated: string;
  dependsOn: string[];
  blockedBy: string;
  /** Thread entry count — the comment counter (all entries, including
   *  automated status-change markers). */
  comments: number;
  /** Task file path relative to <HOME>, for clickable links. */
  path: string;
}

export interface HookEntry {
  event: string;
  command: string;
}

export interface StatusSnapshot {
  runtime: {
    version: string;
    pluginName: string;
    home: string;
    pluginRoot: string;
    timezone: string;
    date: string;
    /** Today as YYYY-MM-DD in TIMEZONE — anchor for due-date grouping. */
    isoDate: string;
    time: string;
    /** Full ISO-8601 with tz offset for the render moment — the client uses it
     *  to compute snapshot age and warn when a sync is overdue. */
    generatedAt: string;
    /** ISO-8601 of the newest briefings-category report (flywheel / morning /
     *  evening) — the last heavy refresh, distinct from the dashboard re-render
     *  that fires on every task mutation. '' when no briefing exists yet. */
    lastSync: string;
    /** HOME template baseline from .kevin/version.json; null on a pre-feature
     *  or uninitialized home. */
    baselineVersion: string | null;
    /** Local upgrade signal: `current` | `pending` | `onboard`. See version.ts. */
    upgradeState: UpgradeState;
    /** Released versions in `(baseline, installed]` per the CHANGELOG. */
    releasesBehind: number;
  };
  persona: Persona;
  operator: OperatorInfo;
  /** URL template for opening markdown files, `{path}` = encoded abs path.
   *  Configurable via the MARKDOWN_URL env var (settings.local.json `env`). */
  markdownUrl: string;
  skills: { count: number; details: SkillInfo[] };
  mcp: { toolCount: number; toolDetails: ToolInfo[] };
  /** Goals blocks from projects/TASKS.md (lines, markdown stripped). */
  goals: { weekly: string[]; monthly: string[]; yearly: string[] };
  /** `## Active Threads` bullets from memory/index.md, markdown stripped. */
  memoryThreads: string[];
  /** `## Recent Decisions` bullets from memory/index.md, markdown stripped. */
  memoryDecisions: string[];
  /** `## Learnings` bullets from memory/index.md, markdown stripped. */
  memoryLearnings: string[];
  /** `## Pending` bullets from memory/index.md, markdown stripped. */
  memoryPending: string[];
  /** Transient daily memory files, newest first, with manifest summaries. */
  memoryDailyFiles: Array<{ name: string; href: string; summary: string }>;
  /** Recent captured sessions (last 30 days), newest first. */
  sessions: SessionRef[];
  /** Headlines from the most recent briefing reports, newest first. */
  news: NewsItem[];
  /** Last knowledge-lint run, parsed from .kevin/lint.md. */
  lint: LintReport;
  /** The bin CLI's HELP text, parsed into sections. */
  cli: CliSection[];
  hooks: { count: number; entries: HookEntry[] };
  knowledge: {
    concepts: number;
    /** Concepts joined with their one-line descriptions from knowledge/index.md. */
    conceptDetails: ConceptInfo[];
    facets: FacetSize[];
    memoryDaily: number;
    memoryIndexBytes: number;
    activeThreads: number;
    learnings: number;
    inboxItems: number;
    feedbackBytes: number;
    totalBytes: number;
    sessionsWeek: SessionDay[];
  };
  compile: {
    ingested: number;
    sessionFiles: number;
    pending: number;
    lastCompiled: string | null;
    totalCostUsd: number;
  };
  tasks: {
    active: number;
    blocked: number;
    stale: number;
    overdue: number;
    projects: number;
    byProject: ProjectLoad[];
    overdueList: TaskRef[];
    staleList: TaskRef[];
    activeList: TaskRef[];
    /** Every open/active/blocked task — the dashboard derives agenda groups. */
    queue: TaskRef[];
    /** Any task (any status) whose `updated:` is today — the activity trail. */
    touchedToday: TaskRef[];
    /** Task id → relative path across every task (live + archived) — lets the
     *  renderer turn `depends on` ids into links to the task file. */
    pathById: Record<string, string>;
  };
  context: {
    staticImports: StaticImport[];
    staticBytes: number;
    dynamic: { date: string; entries: ManifestEntry[]; bytes: number };
    /** Path-scoped coding rules (user + project), newest layer last. */
    rules: RuleEntry[];
  };
  settings: {
    layers: SettingsLayer[];
    allow: number;
    deny: number;
    env: EnvEntry[];
    secrets: SecretEntry[];
    enabledPlugins: string[];
    plugin: PluginRef | null;
  };
  logs: {
    path: string;
    bytes: number;
    warnings: number;
    errors: number;
    totalWarnings: number;
    totalErrors: number;
    lastError: string | null;
    /** Last slice of app.log (credential URLs masked) for the Logs tab. */
    tail: string;
  };
  reports: ReportRef[];
  reportsTotal: number;
  radarLatest: RadarLatest | null;
  /** Parsed CHANGELOG.md entries (newest first) for the System → Changelog tab. */
  changelog: ChangelogEntry[];
  health: Health;
}

const MARKDOWN_RE = /\.md$/;
const SECRET_KEY_RE =
  /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CRED|PRIVATE|OAUTH|SESSION|DB_URL|DB_URI|DATABASE|DSN|CONN|MCP_DB|KEVIN_DB)/i;
/** A connection string with embedded credentials — `scheme://user:pass@host`.
 *  Caught by value so DB URLs are masked regardless of their env-var name. */
const CRED_URL_RE = /:\/\/[^\s:@/]+:[^\s@/]+@/;

/** Count entries in a directory matching a predicate; 0 if the dir is absent. */
const countDir = (dir: string, predicate: (name: string) => boolean): number => {
  try {
    return readdirSync(dir).filter(predicate).length;
  } catch {
    return 0;
  }
};

const listDirs = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
};

const readJson = <T>(path: string): T | null => {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
};

const safeBytes = (path: string): number => {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};

/** Mask a secret value, preserving the last 4 chars when long enough to help
 *  identify which credential it is without exposing it. */
const maskValue = (value: string): string => (value.length > 8 ? `••••${value.slice(-4)}` : '••••••');

/** First sentence of a description, capped — card-sized summaries. */
const firstSentence = (text: string, max = 160): string => {
  const sentence = text.split(/(?<=\.)\s/)[0] ?? text;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
};

/** Description + auto-invocation flag from a SKILL.md's YAML frontmatter.
 *  Descriptions handle both single-line values and folded/literal blocks
 *  (`description: >` followed by indented lines). */
const skillMeta = (skillDir: string): { description: string; auto: boolean } => {
  try {
    const raw = readFileSync(resolve(skillDir, 'SKILL.md'), 'utf-8');
    const auto = !/^disable-model-invocation:\s*true/m.test(raw);
    const lines = raw.split('\n');
    const start = lines.findIndex((line) => line.startsWith('description:'));
    if (start === -1) return { description: '', auto };
    const inline = lines[start].slice('description:'.length).trim();
    if (inline && !/^[>|][+-]?$/.test(inline)) return { description: firstSentence(inline), auto };
    const block: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (!/^\s+\S/.test(line)) break;
      block.push(line.trim());
    }
    return { description: firstSentence(block.join(' ')), auto };
  } catch {
    return { description: '', auto: false };
  }
};

const collectSkills = (): StatusSnapshot['skills'] => {
  const hasSkill = (base: string) => (name: string) => existsSync(resolve(base, name, 'SKILL.md'));
  const skillInfos = (base: string, custom: boolean): SkillInfo[] =>
    listDirs(base)
      .filter(hasSkill(base))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, ...skillMeta(resolve(base, name)), custom }));
  const plugin = skillInfos(resolve(FOLDERS.ROOT, 'skills'), false);
  const customs = skillInfos(resolve(FOLDERS.HOME, '.claude', 'skills'), true);
  const details = [...plugin, ...customs];
  return { count: details.length, details };
};

const collectMcp = async (): Promise<StatusSnapshot['mcp']> => {
  const toolDetails = await collectMcpTools();
  return { toolCount: toolDetails.length, toolDetails };
};

/**
 * Authoritative tool list: gather the side-effect-free `tools` arrays from
 * the same TOOL_MODULES list server.ts registers from. server.ts itself can't
 * be imported (its top-level `server.connect()` would start a server).
 */
const collectMcpTools = async (): Promise<ToolInfo[]> => {
  const lists = await Promise.all(
    TOOL_MODULES.map(async (name) => {
      try {
        const mod = (await import(`@/tools/${name}`)) as {
          tools?: Array<{ name?: string; description?: string }>;
          discoverConnections?: () => Array<{ name: string; envKey: string }>;
          safeConnectionInfo?: (url: string) => { host: string; port: string; database: string };
        };
        const { discoverConnections, safeConnectionInfo } = mod;
        const dbConnections =
          name === 'database' && discoverConnections && safeConnectionInfo
            ? discoverConnections().map((conn) => ({
                name: conn.name,
                ...safeConnectionInfo(env(conn.envKey) ?? '')
              }))
            : undefined;
        return (mod.tools ?? []).map((tool) => ({
          name: tool.name ?? '?',
          description: firstSentence(tool.description ?? ''),
          ...(dbConnections ? { dbConnections } : {})
        }));
      } catch {
        return [];
      }
    })
  );
  return lists.flat().sort((a, b) => a.name.localeCompare(b.name));
};

interface HookConfig {
  hooks?: Array<{ command?: string }>;
}

/** Reduce a hook command to a readable `kevin <verb>` summary. */
const summarizeHookCommand = (command: string): string => {
  const match = command.match(/bin\/kevin"?\s+([a-z-]+(?:\s+--?[a-z-]+=?\S*)?)/);
  return match ? `kevin ${match[1]}` : command.split(/\s+/).slice(0, 3).join(' ');
};

const collectHooks = (): StatusSnapshot['hooks'] => {
  const parsed = readJson<{ hooks?: Record<string, HookConfig[]> }>(resolve(FOLDERS.ROOT, 'hooks', 'hooks.json'));
  const hookMap = parsed?.hooks ?? {};
  const entries: HookEntry[] = Object.keys(hookMap).map((event) => {
    const command = hookMap[event]?.[0]?.hooks?.[0]?.command ?? '';
    return { event, command: command ? summarizeHookCommand(command) : '—' };
  });
  return { count: entries.length, entries };
};

const listMarkdown = (dir: string, exclude: (name: string) => boolean = () => false): string[] => {
  try {
    return readdirSync(dir)
      .filter((name) => MARKDOWN_RE.test(name) && !exclude(name))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
};

/** Recursively sum the bytes of every markdown file under a directory. */
const treeBytes = (dir: string): number => {
  try {
    return readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) return sum + treeBytes(full);
      return MARKDOWN_RE.test(entry.name) ? sum + safeBytes(full) : sum;
    }, 0);
  } catch {
    return 0;
  }
};

/** Non-empty lines under a `## Heading` (prefix match), until the next `##`. */
const sectionLines = (file: string, heading: string): string[] => {
  try {
    const lines = readFileSync(file, 'utf-8').split('\n');
    const start = lines.findIndex((line) => line.trim().startsWith(`## ${heading}`));
    if (start === -1) return [];
    const collected: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (/^## /.test(line)) break;
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('<!--')) collected.push(trimmed);
    }
    return collected;
  } catch {
    return [];
  }
};

/** `- ` bullet texts under a `## Heading`. */
const bulletsUnder = (file: string, heading: string): string[] =>
  sectionLines(file, heading)
    .filter((line) => /^[-*] /.test(line))
    .map((line) => line.replace(/^[-*] /, ''));

/** Count `- ` bullet lines under a `## Heading` in a markdown file. */
const countBulletsUnder = (file: string, heading: string): number => bulletsUnder(file, heading).length;

/** Flatten inline markdown (wikilinks, links, bold, italics, code) to plain text. */
const stripMarkdown = (text: string): string =>
  text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1');

/** Byte size of each of the last 7 days' session transcripts (oldest first). */
const collectSessionsWeek = (): SessionDay[] => {
  const now = new Date();
  return Array.from({ length: 7 }, (_unused, offset) => {
    const day = new Date(now);
    day.setDate(day.getDate() - (6 - offset));
    const iso = day.toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
    const label = day.toLocaleDateString('en-US', {
      timeZone: TIMEZONE,
      weekday: 'short'
    });
    return { label, bytes: safeBytes(resolve(FOLDERS.SESSIONS, `${iso}.md`)) };
  });
};

const collectKnowledge = (): StatusSnapshot['knowledge'] => {
  const conceptNames = listMarkdown(FOLDERS.CONCEPTS, (name) => name === 'index.md').map((name) =>
    name.replace(MARKDOWN_RE, '')
  );
  const facets = listMarkdown(FOLDERS.USER_KNOWLEDGE).map((name) => ({
    name: name.replace(MARKDOWN_RE, ''),
    bytes: safeBytes(resolve(FOLDERS.USER_KNOWLEDGE, name))
  }));
  const conceptDescriptions = wikiIndexDescriptions('concepts');
  return {
    concepts: conceptNames.length,
    conceptDetails: conceptNames.map((name) => ({
      name,
      description: conceptDescriptions.get(name) ?? '',
      href: `knowledge/concepts/${name}.md`
    })),
    facets,
    memoryDaily: countDir(FOLDERS.MEMORY, (name) => /^\d{4}-\d{2}-\d{2}.*\.md$/.test(name)),
    memoryIndexBytes: safeBytes(FILES.MEMORY),
    activeThreads: countBulletsUnder(FILES.MEMORY, 'Active Threads'),
    learnings: countBulletsUnder(FILES.MEMORY, 'Learnings'),
    inboxItems: countDir(FOLDERS.INBOX_RAW, (name) => !name.startsWith('.')),
    feedbackBytes: safeBytes(FILES.FEEDBACK),
    sessionsWeek: collectSessionsWeek(),
    // Curated wiki only — concepts + facets + memory + index. Excludes
    // raw/sessions transcripts, which dwarf the wiki and aren't "knowledge".
    totalBytes:
      treeBytes(FOLDERS.CONCEPTS) +
      treeBytes(FOLDERS.USER_KNOWLEDGE) +
      treeBytes(FOLDERS.MEMORY) +
      safeBytes(FILES.KNOWLEDGE)
  };
};

interface IngestEntry {
  compiled_at?: string;
  cost_usd?: number;
}

const collectCompile = (): StatusSnapshot['compile'] => {
  const state = readJson<{ ingested?: Record<string, IngestEntry> }>(FILES.KNOWLEDGE_STATE);
  const ingestedMap = state?.ingested ?? {};
  const entries = Object.values(ingestedMap);
  const lastCompiled =
    entries
      .map((entry) => entry.compiled_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
  const totalCostUsd = entries.reduce((sum, entry) => sum + (entry.cost_usd ?? 0), 0);
  const sessionFiles = countDir(FOLDERS.SESSIONS, (name) => MARKDOWN_RE.test(name));
  const ingested = Object.keys(ingestedMap).length;
  return {
    ingested,
    sessionFiles,
    pending: Math.max(0, sessionFiles - ingested),
    lastCompiled,
    totalCostUsd
  };
};

const toRef = (task: TaskFile): TaskRef => ({
  id: task.frontmatter.id,
  title: task.frontmatter.title,
  priority: task.frontmatter.priority,
  project: task.frontmatter.project,
  status: task.frontmatter.status,
  due: task.frontmatter.due,
  updated: task.frontmatter.updated,
  dependsOn: task.frontmatter.depends_on,
  blockedBy: task.frontmatter.blocked_by,
  comments: task.thread.length,
  path: relative(FOLDERS.HOME, task.filePath)
});

const OPEN_STATUSES = new Set(['open', 'active', 'blocked']);

/** First plain paragraph of a project README (frontmatter skipped). */
const projectDescription = (project: string): string => firstParagraph(resolve(FOLDERS.PROJECTS, project, 'README.md'));

const collectTasks = (): StatusSnapshot['tasks'] => {
  const all = scanAllTasks();
  const archived = scanArchivedTasks();
  const scan = resolveTasks(all, archived);
  const pathById = Object.fromEntries(
    [...all, ...archived].map((task) => [task.frontmatter.id, relative(FOLDERS.HOME, task.filePath)])
  );
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
  const byStatus = (status: string) => all.filter((task) => task.frontmatter.status === status).length;

  const emptyLoad = (project: string): ProjectLoad => ({
    project,
    open: 0,
    active: 0,
    blocked: 0,
    total: 0,
    done: 0,
    updatedAt: '',
    description: ''
  });

  // Seed every discovered project so those with no live tasks still render as
  // "quiet" cards. Archived projects move out of PROJECTS, so they drop off
  // automatically; without this seeding, a live project whose tasks are all
  // done/archived would silently vanish from the board.
  const projectMap = new Map<string, ProjectLoad>(discoverProjects().map((project) => [project, emptyLoad(project)]));
  for (const task of all) {
    const { project, status, updated } = task.frontmatter;
    const load = projectMap.get(project) ?? emptyLoad(project);
    if (status === 'open') load.open += 1;
    else if (status === 'active') load.active += 1;
    else if (status === 'blocked') load.blocked += 1;
    else load.done += 1;
    if (OPEN_STATUSES.has(status)) load.total += 1;
    if (updated > load.updatedAt) load.updatedAt = updated;
    projectMap.set(project, load);
  }
  const byProject = [...projectMap.values()]
    .map((load) => ({
      ...load,
      done:
        load.done + countDir(resolve(FOLDERS.PROJECTS, load.project, 'tasks', 'archive'), (n) => MARKDOWN_RE.test(n)),
      description: projectDescription(load.project)
    }))
    // Most recently touched project first (by latest live-task `updated:`),
    // then by open-task count, then alphabetically. Quiet projects (no live
    // tasks → empty updatedAt) sink to the bottom deterministically.
    .sort(
      (a, b) =>
        (b.updatedAt || '').localeCompare(a.updatedAt || '') || b.total - a.total || a.project.localeCompare(b.project)
    );

  // Whole working set, P0 first then earliest due — the dashboard's agenda raw material.
  const queue = all
    .filter((task) => OPEN_STATUSES.has(task.frontmatter.status))
    .map(toRef)
    .sort((a, b) => a.priority.localeCompare(b.priority) || (a.due || '9999').localeCompare(b.due || '9999'));

  return {
    active: byStatus('active'),
    blocked: byStatus('blocked'),
    stale: scan.stale.length,
    overdue: scan.overdue.length,
    projects: discoverProjects().length,
    byProject,
    overdueList: scan.overdue.map(toRef),
    staleList: scan.stale.map(toRef),
    activeList: all.filter((task) => task.frontmatter.status === 'active').map(toRef),
    queue,
    // "Today" with date-only granularity: include yesterday too so the feed
    // survives the stroke of midnight (the renderer labels it last-24h).
    touchedToday: all
      .filter((task) => task.frontmatter.updated === today || task.frontmatter.updated === yesterday)
      .map(toRef),
    pathById
  };
};

/** Classify a static-context source into a group for the segmented bar. */
const classifyImport = (label: string): ContextGroup => {
  if (/CLAUDE(\.local)?\.md$/.test(label)) return 'instructions';
  if (/knowledge\/user\//.test(label)) return 'facets';
  if (/^(SOUL|IDENTITY|USER)\.md$/.test(label)) return 'identity';
  if (/index\.md$/.test(label)) return 'knowledge';
  if (/TASKS\.md$/.test(label)) return 'tasks';
  return 'other';
};

const collectContext = async (): Promise<StatusSnapshot['context']> => {
  const source = existsSync(FILES.CLAUDE) ? FILES.CLAUDE : FILES.CLAUDE_LOCAL;
  let labels: string[] = [];
  try {
    labels = readFileSync(source, 'utf-8')
      .split('\n')
      .map((line) => line.match(/^@(\S+)/)?.[1])
      .filter((value): value is string => Boolean(value));
  } catch {
    labels = [];
  }

  // Claude Code loads CLAUDE.md at the user (~/.claude) and project levels
  // *before* the project file's @-imports — surface them as instruction sources.
  const claudeChain: Array<{ label: string; path: string; level: StaticImport['level'] }> = [
    {
      label: '~/.claude/CLAUDE.md',
      path: resolve(homedir(), '.claude', 'CLAUDE.md'),
      level: 'user'
    },
    { label: 'CLAUDE.md', path: FILES.CLAUDE, level: 'project' },
    { label: 'CLAUDE.local.md', path: FILES.CLAUDE_LOCAL, level: 'local' }
  ];
  const claudeImports: StaticImport[] = claudeChain
    .filter((entry) => existsSync(entry.path))
    .map((entry) => ({
      label: entry.label,
      bytes: safeBytes(entry.path),
      present: true,
      group: 'instructions' as const,
      level: entry.level
    }));

  const atImports: StaticImport[] = labels.map((label) => {
    const bytes = safeBytes(resolve(FOLDERS.HOME, label));
    return { label, bytes, present: bytes > 0, group: classifyImport(label) };
  });

  const staticImports = [...claudeImports, ...atImports];
  const staticBytes = staticImports.reduce((sum, item) => sum + item.bytes, 0);

  const dynamic = await contextManifest().catch(() => ({
    date: '',
    entries: [] as ManifestEntry[],
    bytes: 0
  }));

  return { staticImports, staticBytes, dynamic, rules: collectRules() };
};

/** Pull the `paths:` glob list out of a rule file's YAML frontmatter. Hand-rolled
 *  rather than a YAML dep: the only shape we read is a `paths:` block of quoted
 *  `- "glob"` items between the leading `---` fences. */
const parseRulePaths = (raw: string): string[] => {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return [];
  const lines = match[1].split('\n');
  const start = lines.findIndex((line) => /^paths:/.test(line));
  if (start === -1) return [];
  const paths: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const item = lines[i].match(/^\s+-\s+(.+?)\s*$/);
    if (!item) break;
    paths.push(item[1].replace(/^["']|["']$/g, ''));
  }
  return paths;
};

/** Read the path-scoped coding rules from a `.claude/rules` directory. */
const collectRulesFrom = (dir: string, level: RuleEntry['level']): RuleEntry[] => {
  try {
    return readdirSync(dir)
      .filter((name) => MARKDOWN_RE.test(name))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        const path = resolve(dir, name);
        return {
          name: name.replace(MARKDOWN_RE, ''),
          level,
          paths: parseRulePaths(readFileSync(path, 'utf-8')),
          bytes: safeBytes(path),
          path: level === 'project' ? relative(FOLDERS.HOME, path) : path
        };
      });
  } catch {
    return [];
  }
};

/** User rules first (they load before project rules), then project rules. */
const collectRules = (): RuleEntry[] => [
  ...collectRulesFrom(resolve(homedir(), '.claude', 'rules'), 'user'),
  ...collectRulesFrom(resolve(FOLDERS.HOME, '.claude', 'rules'), 'project')
];

const collectSettings = (): StatusSnapshot['settings'] => {
  const blank = { present: false, allow: 0, deny: 0, envCount: 0 };
  const layerDefs: SettingsLayer[] = [
    { label: 'user', path: resolve(homedir(), '.claude', 'settings.json'), ...blank },
    { label: 'project', path: resolve(FOLDERS.HOME, '.claude', 'settings.json'), ...blank },
    { label: 'local', path: resolve(FOLDERS.HOME, '.claude', 'settings.local.json'), ...blank }
  ];

  interface MarketplaceSource {
    source?: { source?: string; path?: string };
  }
  interface SettingsShape {
    permissions?: { allow?: string[]; deny?: string[] };
    env?: Record<string, string>;
    enabledPlugins?: Record<string, boolean>;
    extraKnownMarketplaces?: Record<string, MarketplaceSource>;
  }

  const env = new Map<string, { value: string; scope: EnvEntry['scope'] }>();
  const enabledPlugins = new Set<string>();
  const marketplaces: Record<string, MarketplaceSource> = {};
  let allow = 0;
  let deny = 0;

  const layers = layerDefs.map((layer) => {
    const parsed = readJson<SettingsShape>(layer.path);
    if (!parsed) return layer;
    const scope: EnvEntry['scope'] = layer.label === 'user' ? 'user' : 'workspace';
    const layerAllow = parsed.permissions?.allow?.length ?? 0;
    const layerDeny = parsed.permissions?.deny?.length ?? 0;
    allow += layerAllow;
    deny += layerDeny;
    Object.entries(parsed.env ?? {}).forEach(([key, value]) => env.set(key, { value, scope }));
    Object.entries(parsed.enabledPlugins ?? {}).forEach(([name, on]) => on && enabledPlugins.add(name));
    Object.assign(marketplaces, parsed.extraKnownMarketplaces ?? {});
    return {
      ...layer,
      present: true,
      allow: layerAllow,
      deny: layerDeny,
      envCount: Object.keys(parsed.env ?? {}).length
    };
  });

  const redactedEnv: EnvEntry[] = [...env.entries()].map(([key, entry]) => ({
    key,
    value: SECRET_KEY_RE.test(key) || CRED_URL_RE.test(entry.value) ? maskValue(entry.value) : entry.value,
    scope: entry.scope
  }));

  // Always surface KEVIN_HOME so its meaning is discoverable even when unset
  // (it then falls back to the launch cwd). Empty value renders as "not set".
  if (!redactedEnv.some((entry) => entry.key === 'KEVIN_HOME')) {
    redactedEnv.unshift({ key: 'KEVIN_HOME', value: '', scope: 'user' });
  }

  // Resolve the current plugin's enabled ref + its marketplace source.
  const ref = [...enabledPlugins].find((name) => name.startsWith(`${PLUGIN_NAME}@`));
  const marketplace = ref?.split('@')[1] ?? '';
  const source = marketplaces[marketplace]?.source;
  const plugin: PluginRef | null = ref
    ? {
        ref,
        marketplace,
        sourceType: source?.source ?? 'unknown',
        sourcePath: source?.path ?? ''
      }
    : null;

  return {
    layers,
    allow,
    deny,
    env: redactedEnv,
    secrets: listSecretEntries(),
    enabledPlugins: [...enabledPlugins],
    plugin
  };
};

// Anchor on the level field (right after the ISO-UTC timestamp) so a "WARN"/
// "ERROR" substring inside a message body never inflates the count.
const LEVEL_RE = /^\S+Z (WARN|ERROR) /;

/** Bytes of app.log surfaced in the System → Logs tab. */
const LOG_TAIL_BYTES = 100_000;

const collectLogs = (): StatusSnapshot['logs'] => {
  const path = resolve(FOLDERS.LOGS, 'app.log');
  let bytes = 0;
  let warnings = 0;
  let errors = 0;
  let totalWarnings = 0;
  let totalErrors = 0;
  let lastError: string | null = null;
  let tail = '';
  try {
    bytes = statSync(path).size;
    const today = new Date().toISOString().slice(0, 10);
    const content = readFileSync(path, 'utf-8');
    for (const line of content.split('\n')) {
      const level = line.match(LEVEL_RE)?.[1];
      if (!level) continue;
      const isToday = line.startsWith(today);
      if (level === 'WARN') {
        totalWarnings += 1;
        if (isToday) warnings += 1;
      } else {
        totalErrors += 1;
        if (isToday) errors += 1;
        lastError = line.replace(LEVEL_RE, '').slice(0, 80);
      }
    }
    const slice = content.slice(-LOG_TAIL_BYTES);
    // Start at a line boundary and mask any credentialed URLs defensively.
    tail = slice.slice(slice.indexOf('\n') + 1).replace(/:\/\/[^\s:@/]+:[^\s@/]+@/g, '://••••:••••@');
  } catch {
    // no log yet
  }
  return {
    path,
    bytes,
    warnings,
    errors,
    totalWarnings,
    totalErrors,
    lastError,
    tail
  };
};

// ── identity parsing (IDENTITY.md / SOUL.md / USER.md — all best-effort) ──

/** Value of a `**Label:** value` bullet anywhere in a markdown file. */
const boldField = (file: string, label: string): string => {
  try {
    return (
      readFileSync(file, 'utf-8')
        .match(new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)$`, 'm'))?.[1]
        ?.trim() ?? ''
    );
  } catch {
    return '';
  }
};

/** First markdown image path in a file, kept only if it exists under HOME. */
const firstImage = (file: string): string => {
  try {
    const path = readFileSync(file, 'utf-8').match(/!\[[^\]]*\]\(([^)]+)\)/)?.[1] ?? '';
    return path && existsSync(resolve(FOLDERS.HOME, path)) ? path : '';
  } catch {
    return '';
  }
};

/** Paragraph text (non-bullet lines) under a `## Heading`, joined. */
const sectionText = (file: string, heading: string): string =>
  stripMarkdown(
    sectionLines(file, heading)
      .filter((line) => !/^[-*>!]/.test(line) && !line.startsWith('_('))
      .join(' ')
  );

/** `- [[prefix/name]] — description` entries from knowledge/index.md. */
const wikiIndexDescriptions = (prefix: string): Map<string, string> => {
  const map = new Map<string, string>();
  try {
    const re = new RegExp(`^- \\[\\[${prefix}/([^\\]]+)\\]\\]\\s*—\\s*(.+)$`, 'gm');
    for (const match of readFileSync(FILES.KNOWLEDGE, 'utf-8').matchAll(re)) {
      map.set(match[1], stripMarkdown(match[2]));
    }
  } catch {
    // no wiki index yet
  }
  return map;
};

// Pre-init fallback: derive the agent's name from the plugin id (agent-walle → Walle).
const FALLBACK_AGENT_NAME = PLUGIN_NAME.replace(/^agent-/, '').replace(/^./, (c) => c.toUpperCase());

// Rendered in the persona header (name/kind/vibe chips + bio), so their
// sections would only duplicate it below.
const PERSONA_HEAD_SECTIONS = new Set(['Who', 'Short Bio']);

const collectPersona = (): Persona => ({
  name: boldField(FILES.IDENTITY, 'Name') || FALLBACK_AGENT_NAME,
  kind: stripMarkdown(boldField(FILES.IDENTITY, 'Kind')),
  // Forks word the tagline field differently (Vibe, Register, ...).
  vibe: stripMarkdown(boldField(FILES.IDENTITY, 'Vibe') || boldField(FILES.IDENTITY, 'Register')),
  emoji: boldField(FILES.IDENTITY, 'Emoji'),
  avatar: firstImage(FILES.IDENTITY),
  bio: sectionText(FILES.IDENTITY, 'Short Bio'),
  identitySections: mdSections(FILES.IDENTITY).filter((section) => !PERSONA_HEAD_SECTIONS.has(section.title)),
  soulSections: mdSections(FILES.SOUL)
});

/** Sections that are link farms or provenance, not profile content. */
const PROFILE_SKIP_SECTIONS = new Set(['See Also', 'Deep Dive', 'Sources']);
const PROFILE_SECTION_LINES = 12;

/** Every `## Section` of a markdown file as stripped text lines. */
const mdSections = (file: string): ProfileSection[] => {
  try {
    const lines = readFileSync(file, 'utf-8').split('\n');
    const sections: ProfileSection[] = [];
    let current: ProfileSection | null = null;
    for (const line of lines) {
      const heading = line.match(/^## (.+)$/);
      if (heading) {
        current = { title: heading[1].trim(), lines: [] };
        sections.push(current);
        continue;
      }
      const trimmed = line.trim();
      if (!current || !trimmed || trimmed.startsWith('![') || trimmed.startsWith('<!--')) continue;
      if (current.lines.length < PROFILE_SECTION_LINES) {
        // Keep web links recoverable: `[text](http…)` → `text (http…)` so the
        // renderer can linkify them after the markdown strip.
        const linksKept = trimmed.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)');
        current.lines.push(stripMarkdown(linksKept.replace(/^[-*] /, '')));
      }
    }
    return sections.filter((section) => section.lines.length && !PROFILE_SKIP_SECTIONS.has(section.title));
  } catch {
    return [];
  }
};

/** First plain paragraph of a markdown file (frontmatter + headings skipped). */
const firstParagraph = (file: string): string => {
  try {
    const body = readFileSync(file, 'utf-8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    const paragraph = body.split('\n').find((line) => line.trim() && !/^[#>\-*!|<\[]/.test(line.trim()));
    return paragraph ? stripMarkdown(paragraph.trim()) : '';
  } catch {
    return '';
  }
};

const collectOperatorInfo = (facetSizes: FacetSize[]): OperatorInfo => {
  const descriptions = wikiIndexDescriptions('user');
  const profilePath = resolve(FOLDERS.USER_KNOWLEDGE, 'profile.md');
  return {
    name: boldField(FILES.USER, 'Name'),
    timezone:
      stripMarkdown(boldField(FILES.USER, 'Home timezone') || boldField(FILES.USER, 'Timezone')).split(/\s+/)[0] ?? '',
    avatar: firstImage(FILES.USER),
    headline: firstParagraph(profilePath),
    profileSections: mdSections(profilePath),
    facets: facetSizes.map((facet) => ({
      name: facet.name,
      description: descriptions.get(facet.name) ?? '',
      bytes: facet.bytes,
      href: `knowledge/user/${facet.name}.md`
    }))
  };
};

/** Strip harness boilerplate from captured briefings: injected XML-ish tags
 *  (`<command-message>` etc.) and the local-command caveat preamble. Briefings
 *  are pre-truncated in the index, so the caveat may be cut mid-sentence —
 *  strip greedily and let the renderer show a fallback when nothing remains.
 *  Whitespace collapses first so the caveat regex can't be split by newlines. */
const cleanBriefing = (text: string): string =>
  text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/Caveat: The messages below.*?(unless the user explicitly asks you to\.|$)/i, ' ')
    .trim();

const MAX_SESSIONS = 60;
const SESSION_WINDOW_DAYS = 30;

interface SessionIndexRecord {
  first_seen?: string;
  last_seen?: string;
  cwd?: string;
  captured_turns?: number;
  briefing?: string;
}

/** Command sessions: render `/name args` from the captured invocation tags
 *  instead of the stripped tag soup ("agent-kevin:sync /agent-kevin:sync"). */
const commandBriefing = (raw: string): string => {
  const name = raw.match(/<command-name>([^<]*)</)?.[1]?.trim();
  const message = raw.match(/<command-message>([^<]*)</)?.[1]?.trim();
  const command = name || (message ? `/${message}` : '');
  if (!command) return cleanBriefing(raw);
  const args = raw.match(/<command-args>([^<]*)</)?.[1]?.trim();
  return [command, args].filter(Boolean).join(' ');
};

/** `idShort → HH:MM` of each session's latest captured block, harvested from
 *  the given day-files (oldest first, so newer blocks win). */
const BLOCK_TIME_RE = /^### (?:Session|Pre-Compact) \((\d{2}:\d{2})\) \[([0-9a-fA-F]+)\]/gm;

const collectBlockTimes = (days: string[]): Map<string, string> => {
  const times = new Map<string, string>();
  for (const day of days) {
    try {
      const content = readFileSync(resolve(FOLDERS.SESSIONS, `${day}.md`), 'utf-8');
      for (const match of content.matchAll(BLOCK_TIME_RE)) {
        times.set(match[2], match[1]);
      }
    } catch {
      // no transcript captured that day
    }
  }
  return times;
};

const collectSessions = (): SessionRef[] => {
  const parsed = readJson<{ sessions?: Record<string, SessionIndexRecord> }>(FILES.SESSION_INDEX);
  const dayInTz = (msAgo: number) => new Date(Date.now() - msAgo).toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
  const cutoff = dayInTz(SESSION_WINDOW_DAYS * 86_400_000);
  const blockTimes = collectBlockTimes([dayInTz(86_400_000), dayInTz(0)]);
  return Object.entries(parsed?.sessions ?? {})
    .map(([id, record]) => {
      const raw = (record.briefing ?? '').trim();
      const isCommand = raw.startsWith('<command-') || raw.startsWith('/');
      return {
        id,
        firstSeen: record.first_seen ?? '',
        lastSeen: record.last_seen ?? record.first_seen ?? '',
        time: blockTimes.get(id) ?? '',
        turns: record.captured_turns ?? 0,
        cwd: record.cwd ?? '',
        briefing: isCommand ? commandBriefing(raw) : cleanBriefing(raw),
        isCommand
      };
    })
    .filter((session) => session.lastSeen >= cutoff)
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || b.id.localeCompare(a.id))
    .slice(0, MAX_SESSIONS);
};

// ── news / lint / cli ─────────────────────────────────────────────────

const NEWS_BRIEFINGS = 15;
const MAX_NEWS = 30;
/** `[Title](http://…)` optionally followed by a `(Source, date)` annotation. */
const NEWS_LINK_RE = /\[([^\]]+)\]\((https?:[^)]+)\)\s*(?:\(([^)]+)\))?/;
/** Bullet with a bold, link-less headline — `- ☪️ **Headline** (Source, date)`. */
const NEWS_BOLD_RE = /^\s*[-•*]\s*(?:\S+\s+)?\*\*([^*]+)\*\*\s*(?:\(([^)]+)\))?/;
/** Trailing parens longer than this are prose, not a `(Source, date)` tag. */
const MAX_SOURCE = 48;

/** Harvest headlines from the News/Signals sections of the most recent
 *  briefing reports — markdown-linked ones and bold link-less ones alike.
 *  Deduped by URL/title, newest briefing first. */
const collectNews = (): NewsItem[] => {
  const dir = resolve(FOLDERS.REPORTS, 'briefings');
  const files = listMarkdown(dir)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, NEWS_BRIEFINGS);
  const seen = new Set<string>();
  const items: NewsItem[] = [];
  for (const name of files) {
    const date = name.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? '';
    let inNews = false;
    let content = '';
    try {
      content = readFileSync(resolve(dir, name), 'utf-8');
    } catch {
      continue;
    }
    for (const line of content.split('\n')) {
      if (/📰|🌐/.test(line)) {
        // The marker line itself may carry an inline headline — keep scanning.
        inNews = true;
      } else if (/^\s*(\*\*)?[👉🍌📋🎯⚙️🔄✅⚠️]/u.test(line.trim()) || /^#{1,3} /.test(line)) {
        // Any other section marker ends the news block.
        inNews = false;
        continue;
      }
      if (!inNews) continue;
      const linked = line.match(NEWS_LINK_RE);
      if (linked) {
        if (seen.has(linked[2])) continue;
        seen.add(linked[2]);
        items.push({ date, title: stripMarkdown(linked[1]), url: linked[2], source: linked[3] ?? '' });
        continue;
      }
      const bold = line.match(NEWS_BOLD_RE);
      if (!bold) continue;
      const title = stripMarkdown(bold[1]);
      if (seen.has(title)) continue;
      seen.add(title);
      const source = bold[2] && bold[2].length <= MAX_SOURCE ? bold[2] : '';
      items.push({ date, title, url: '', source });
    }
  }
  return items.slice(0, MAX_NEWS);
};

/** Parse .kevin/lint.md (written by knowledge_lint) into counts + issues. */
const collectLint = (): LintReport => {
  const empty: LintReport = { date: '', errors: 0, warnings: 0, suggestions: 0, issues: [], present: false };
  let content = '';
  try {
    content = readFileSync(resolve(FOLDERS.DATA, 'lint.md'), 'utf-8');
  } catch {
    return empty;
  }
  const count = (label: string) => parseInt(content.match(new RegExp(`- ${label}: (\\d+)`))?.[1] ?? '0', 10);
  const issues = [...content.matchAll(/^- \*\*([A-Z]+)\*\*: (.+)$/gm)].map((match) => ({
    severity: match[1],
    text: stripMarkdown(match[2])
  }));
  return {
    date: content.match(/^Date: (.+)$/m)?.[1] ?? '',
    errors: count('Errors'),
    warnings: count('Warnings'),
    suggestions: count('Suggestions'),
    issues,
    present: true
  };
};

/** Parse the bin CLI's HELP template literal into sections of cmd/desc rows. */
const collectCli = (): CliSection[] => {
  let content = '';
  try {
    content = readFileSync(resolve(FOLDERS.ROOT, 'bin', PLUGIN_NAME.replace(/^agent-/, '')), 'utf-8');
  } catch {
    return [];
  }
  const help = content.match(/const HELP = `([\s\S]*?)`;/)?.[1];
  if (!help) return [];
  const sections: CliSection[] = [];
  let current: CliSection | null = null;
  for (const line of help.split('\n')) {
    const heading = line.match(/^([A-Z][^:]+):$/);
    if (heading) {
      current = { section: heading[1], entries: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    const entry = line.match(/^  (\S.*?)\s{2,}(.+)$/);
    if (entry) {
      current.entries.push({ cmd: entry[1], desc: entry[2] });
    } else if (/^  \S/.test(line)) {
      // Entry with no inline description (e.g. long Examples lines).
      current.entries.push({ cmd: line.trim(), desc: '' });
    } else if (/^\s{4,}\S/.test(line) && current.entries.length) {
      // Continuation of the previous entry's description.
      current.entries[current.entries.length - 1].desc += ` ${line.trim()}`;
    }
  }
  return sections.filter((section) => section.entries.length);
};

// paneType=tab keeps the dashboard tab alive — Obsidian opens the note in a
// new tab instead of replacing the active one.
const DEFAULT_MARKDOWN_URL = 'obsidian://open?path={path}&paneType=tab';

/** Markdown-opener URL template from the MARKDOWN_URL env var; must be a
 *  custom scheme carrying a `{path}` placeholder, else the Obsidian default
 *  applies. */
const collectMarkdownUrl = (): string => {
  const valid = /^[a-z][a-z0-9.+-]*:\/\//i.test(MARKDOWN_URL) && MARKDOWN_URL.includes('{path}');
  return valid ? MARKDOWN_URL : DEFAULT_MARKDOWN_URL;
};

const collectRuntime = (): StatusSnapshot['runtime'] => {
  const manifest = readJson<{ name?: string; version?: string }>(
    resolve(FOLDERS.ROOT, '.claude-plugin', 'plugin.json')
  );
  const now = new Date();
  const upgrade = getUpgradeStatus();
  return {
    version: manifest?.version ?? '0.0.0',
    pluginName: manifest?.name ?? 'agent-kevin',
    home: FOLDERS.HOME,
    pluginRoot: FOLDERS.ROOT,
    timezone: TIMEZONE,
    date: now.toLocaleDateString('en-GB', {
      timeZone: TIMEZONE,
      weekday: 'short',
      day: '2-digit',
      month: 'short'
    }),
    isoDate: now.toLocaleDateString('sv-SE', { timeZone: TIMEZONE }),
    time: nowTime(now),
    generatedAt: nowISO(now),
    // Filled in collectStatus, which has the report list to derive it from.
    lastSync: '',
    baselineVersion: upgrade.baseline,
    upgradeState: upgrade.state,
    releasesBehind: upgrade.releasesBehind
  };
};

const REPORT_CATEGORIES = ['briefings', 'plans', 'radar', 'permissions', 'api'] as const;
const REPORT_FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

/** Category segment from an href like `reports/plans/2026-…md` → `plans`. */
const categoryFromHref = (href: string): string => href.split('/')[1] ?? '';

/** Display title for an orphan report file (one written outside report_write,
 *  e.g. a plan-mode export): frontmatter `title:`, else the first H1, else the
 *  filename. */
const orphanReportTitle = (body: string, fileName: string): string => {
  const frontmatter = body.match(REPORT_FRONTMATTER_RE)?.[1];
  const fmTitle = frontmatter
    ?.match(/^title:\s*(.+)$/m)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, '');
  if (fmTitle) return fmTitle;
  const h1 = body
    .replace(REPORT_FRONTMATTER_RE, '')
    .match(/^#\s+(.+)$/m)?.[1]
    ?.trim();
  return h1 ?? fileName.replace(MARKDOWN_RE, '');
};

/** Report entries for the dashboard, newest first. Two sources merged:
 *  1. `reports/index.md` — the authoritative, curated log (title/skill/status)
 *     written by `report_write`.
 *  2. A disk sweep of each category folder for files NOT in the index — chiefly
 *     plans saved by the harness's plan-mode export, which never touch the
 *     index. Without (2) those plans never surface on the Reports page. */
const collectReports = (): ReportRef[] => {
  const refs: ReportRef[] = [];
  const seen = new Set<string>();

  try {
    let day = '';
    for (const line of readFileSync(FILES.REPORTS_INDEX, 'utf-8').split('\n')) {
      const heading = line.match(/^## (\d{4}-\d{2}-\d{2})/);
      if (heading) {
        day = heading[1];
        continue;
      }
      const entry = line.match(/^- (\d{2}:\d{2}) · \[([^\]]+)\](?:\(([^)]+)\))?(?: · `([^`]+)`)?(?: · (\S+))?/);
      if (!entry) continue;
      // Index links are relative to reports/; the dashboard sits at <HOME>.
      const href = entry[3] ? `reports/${entry[3]}` : '';
      if (href) seen.add(href);
      refs.push({
        date: day,
        time: entry[1],
        title: entry[2],
        href,
        skill: entry[4] ?? '',
        status: entry[5] ?? '',
        category: categoryFromHref(href)
      });
    }
  } catch {
    // No index yet — the disk sweep below still surfaces any orphan files.
  }

  for (const category of REPORT_CATEGORIES) {
    const dir = resolve(FOLDERS.REPORTS, category);
    for (const fileName of listMarkdown(dir)) {
      const href = `reports/${category}/${fileName}`;
      if (seen.has(href)) continue;
      seen.add(href);
      const full = resolve(dir, fileName);
      let body = '';
      try {
        body = readFileSync(full, 'utf-8');
      } catch {
        continue;
      }
      const stamp = fileName.match(/^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})/);
      const mtime = stamp ? null : safeMtime(full);
      refs.push({
        date: stamp?.[1] ?? todayDate(mtime ?? new Date(0)),
        time: stamp ? `${stamp[2]}:${stamp[3]}` : nowTime(mtime ?? new Date(0)),
        title: orphanReportTitle(body, fileName),
        href,
        skill: '',
        status: '',
        category
      });
    }
  }

  return refs.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
};

const safeMtime = (path: string): Date => {
  try {
    return statSync(path).mtime;
  } catch {
    return new Date(0);
  }
};

// ── radar: per-session related tasks + plans ──────────────────────────
//
// The Recent tab links each session card to the tasks it worked on and the
// plans it produced, derived at build time from the session's transcript. The
// pure extraction/formatting lives in radar-refs.ts (config-free, testable);
// collect.ts owns only the disk I/O (locate + read the transcript).

const CLAUDE_PROJECTS_DIR = resolve(homedir(), '.claude', 'projects');

/** Locate `<id>.jsonl` under any ~/.claude/projects/<dir>/; null if absent. */
const findTranscript = (sessionId: string): string | null => {
  let dirs: string[] = [];
  try {
    dirs = readdirSync(CLAUDE_PROJECTS_DIR);
  } catch {
    return null;
  }
  const hit = dirs
    .map((dir) => resolve(CLAUDE_PROJECTS_DIR, dir, `${sessionId}.jsonl`))
    .find((path) => existsSync(path));
  return hit ?? null;
};

/** The 🔗 tasks + 📋 plans rows (raw HTML) for one session card; '' when none. */
const sessionMetaRows = (
  sessionId: string,
  taskIndex: Map<string, RadarTaskRef>,
  planTitles: Map<string, string>,
  markdownUrl: string
): string => {
  const transcript = findTranscript(sessionId);
  let lines: string[] = [];
  if (transcript) {
    try {
      lines = readFileSync(transcript, 'utf-8').split('\n');
    } catch {
      lines = [];
    }
  }
  const refs = extractSessionRefs(conversationTextFromLines(lines), taskIndex);
  return composeMetaRows(refs, taskIndex, planTitles, markdownUrl, FOLDERS.HOME);
};

/** Read the newest radar report's body and render it to HTML for the Sessions
 *  page Radar tab. `reports` must be newest-first (collectReports output). */
const collectRadarLatest = async (reports: ReportRef[]): Promise<RadarLatest | null> => {
  const ref = reports.find((report) => report.category === 'radar' && report.href);
  if (!ref) return null;
  let body = '';
  try {
    body = readFileSync(resolve(FOLDERS.HOME, ref.href), 'utf-8');
  } catch {
    return null;
  }
  // Lift the digest's trailing "--- *N sessions · window · scope*" footer out of
  // the body; the dashboard renders it below its own divider, with the radar
  // count note.
  let footer: string | undefined;
  const raw = body
    .replace(REPORT_FRONTMATTER_RE, '')
    .trim()
    .replace(/\n*---\s*\n+\*([^\n]*)\*\s*$/, (_match, stats: string) => {
      footer = stats.trim();
      return '';
    });
  if (!raw) return null;
  // The digest writes title / summary / resume on consecutive lines separated
  // by single newlines, which markdown collapses into one run-on paragraph.
  // Force a blank line after each "**N. …**" title line and before each "↳"
  // resume line so they render as distinct blocks. Idempotent: the negative
  // lookahead skips lines already blank-separated.
  const normalized = raw.replace(/^(\*\*\d+\..*)\n(?!\n)/gm, '$1\n\n').replace(/([^\n])\n(↳ )/g, '$1\n\n$2');
  // Per-session related tasks + plans, derived from each session's transcript;
  // built off `raw`/`normalized` only, so the Today feed (parseRadarSessions on
  // `raw`) is untouched and only the Recent tab gains them.
  const taskIndex = new Map<string, RadarTaskRef>(
    [...scanAllTasks(), ...scanArchivedTasks()].map((task) => [
      task.frontmatter.id,
      { title: task.frontmatter.title, filePath: task.filePath }
    ])
  );
  const planTitles = new Map<string, string>(
    reports.filter((report) => report.category === 'plans' && report.href).map((report) => [report.href, report.title])
  );
  const markdownUrl = collectMarkdownUrl();
  // Read each transcript at most once; both feeds reuse the same meta rows.
  const metaCache = new Map<string, string>();
  const metaFor = (sessionId: string): string => {
    const cached = metaCache.get(sessionId);
    if (cached !== undefined) return cached;
    const rows = sessionMetaRows(sessionId, taskIndex, planTitles, markdownUrl);
    metaCache.set(sessionId, rows);
    return rows;
  };
  const { marked } = await import('marked');
  // Replace each rendered resume paragraph with a `.radar-meta` box that groups
  // the session's tasks + plans (when any) and the resume command into one
  // subsection, set apart from the summary. Done post-marked so the box is a
  // block sibling (a <div> can't live inside the <p> marked emits) and a single
  // pass — no double-wrapping.
  const rendered = (await marked.parse(normalized)).replace(
    /<p>↳\s*<code>claude --resume ([0-9a-fA-F-]+)<\/code><\/p>/g,
    (_full, sessionId: string) => composeMetaBox(metaFor(sessionId), `claude --resume ${sessionId}`)
  );
  // Wrap each session run (its `<strong>N. …</strong>` title paragraph through
  // its summary and meta box) in a `data-row` div so the Recent tab's filterbox
  // can show/hide whole sessions by matching title + summary text. Allow the
  // opener scheme so the injected task/plan links keep their href.
  const scheme = markdownUrl.match(/^([a-z][a-z0-9.+-]*):/i)?.[1];
  const html = wrapRadarSessions(await sanitizeHtml(rendered, scheme ? { allowSchemes: [scheme] } : undefined));
  // Enrich the Today-feed rows with the same per-session meta (tasks + plans).
  const sessions = parseRadarSessions(raw).map((session) => {
    const sessionId = session.resume.match(/claude --resume ([0-9a-fA-F-]+)/)?.[1];
    return { ...session, meta: sessionId ? metaFor(sessionId) : '' };
  });
  return {
    date: ref.date,
    time: ref.time,
    title: ref.title,
    href: ref.href,
    html,
    footer,
    sessions
  };
};

/** Wrap each rendered session run in `<div class="radar-session" data-row>` so
 *  the Recent tab's session filter can match against the row's full text (title
 *  + summary) and hide non-matches. A run spans from a numbered title paragraph
 *  up to the next one, the next `<h2>` section header, or the end. */
const wrapRadarSessions = (html: string): string =>
  html.replace(/(<p><strong>\d+\.[\s\S]*?)(?=<p><strong>\d+\.|<h2|$)/g, '<div class="radar-session" data-row>$1</div>');

/** Pull the digest's per-session blocks (`**N. Title** · *time ago*`, a summary,
 *  then a `↳ claude --resume …` line) into structured rows for the Today feed. */
const parseRadarSessions = (raw: string): RadarSession[] => {
  const sessions: RadarSession[] = [];
  for (const block of raw.matchAll(
    /\*\*\d+\.\s*([\s\S]*?)\*\*\s*·\s*\*([^*]+)\*([\s\S]*?)(?=\n\*\*\d+\.\s|\n##\s|$)/g
  )) {
    const body = block[3];
    const resume = body.match(/↳\s*`?(claude --resume[^\n`]+)`?/)?.[1]?.trim() ?? '';
    sessions.push({
      title: stripMarkdown(block[1].trim()),
      timeAgo: block[2].trim(),
      summary: stripMarkdown(
        body
          .replace(/↳\s*`?claude --resume[^\n`]+`?/g, '')
          .replace(/\s+/g, ' ')
          .trim()
      ),
      resume,
      meta: ''
    });
  }
  return sessions;
};

const TASKS_DASHBOARD = resolve(FOLDERS.PROJECTS, 'TASKS.md');

/** Goal lines under a TASKS.md heading. The scaffold's italic `_No … yet_`
 *  placeholders are dropped so unset goals render the dashboard's own hint. */
const goalLines = (heading: string): string[] =>
  sectionLines(TASKS_DASHBOARD, heading)
    .filter((line) => !/^_No .+_$/.test(line))
    .map(stripMarkdown);

const collectGoals = (): StatusSnapshot['goals'] => ({
  weekly: goalLines('Weekly Goals'),
  monthly: goalLines('Monthly Goals'),
  yearly: goalLines('Yearly Goals')
});

const MAX_THREADS = 12;

const collectMemoryThreads = (): string[] =>
  bulletsUnder(FILES.MEMORY, 'Active Threads').slice(0, MAX_THREADS).map(stripMarkdown);

const collectMemoryDecisions = (): string[] =>
  bulletsUnder(FILES.MEMORY, 'Recent Decisions').slice(0, MAX_THREADS).map(stripMarkdown);

const collectMemoryLearnings = (): string[] =>
  bulletsUnder(FILES.MEMORY, 'Learnings').slice(0, MAX_THREADS).map(stripMarkdown);

const collectMemoryPending = (): string[] =>
  bulletsUnder(FILES.MEMORY, 'Pending').slice(0, MAX_THREADS).map(stripMarkdown);

const collectMemoryDailyFiles = (): Array<{ name: string; href: string; summary: string }> => {
  // The `## Daily Memory` manifest carries a one-line summary per day file.
  const summaries = new Map<string, string>();
  for (const bullet of bulletsUnder(FILES.MEMORY, 'Daily Memory')) {
    const match = bullet.match(/^\[\[memory\/([^\]|]+)\]\]\s*—\s*(.+)$/);
    if (match) summaries.set(match[1], stripMarkdown(match[2]));
  }
  return listMarkdown(FOLDERS.MEMORY, (name) => !/^\d{4}-\d{2}-\d{2}/.test(name))
    .sort((a, b) => b.localeCompare(a))
    .map((name) => {
      const day = name.replace(MARKDOWN_RE, '');
      return { name: day, href: `knowledge/memory/${name}`, summary: summaries.get(day) ?? '' };
    });
};

const computeHealth = (snap: Omit<StatusSnapshot, 'health'>): Health => {
  const overdue = snap.tasks.overdue;
  const pendingCompiles = snap.compile.pending;
  const logErrors = snap.logs.errors;
  const missingImports = snap.context.staticImports.filter((item) => !item.present).length;
  return {
    overdue,
    pendingCompiles,
    logErrors,
    missingImports,
    ok: overdue === 0 && pendingCompiles === 0 && logErrors === 0 && missingImports === 0
  };
};

const MAX_REPORTS = 60;

/** ISO-8601 (with current tz offset) of the newest briefings-category report.
 *  `reports` must be newest-first. '' when none exists. */
const lastSyncIso = (reports: ReportRef[]): string => {
  const latest = reports.find((ref) => ref.category === 'briefings' && ref.date && ref.time);
  return latest ? `${latest.date}T${latest.time}:00${offsetFor()}` : '';
};

export const collectStatus = async (): Promise<StatusSnapshot> => {
  const allReports = collectReports();
  const knowledge = collectKnowledge();
  const base = {
    runtime: { ...collectRuntime(), lastSync: lastSyncIso(allReports) },
    persona: collectPersona(),
    operator: collectOperatorInfo(knowledge.facets),
    markdownUrl: collectMarkdownUrl(),
    skills: collectSkills(),
    mcp: await collectMcp(),
    goals: collectGoals(),
    memoryThreads: collectMemoryThreads(),
    memoryDecisions: collectMemoryDecisions(),
    memoryLearnings: collectMemoryLearnings(),
    memoryPending: collectMemoryPending(),
    memoryDailyFiles: collectMemoryDailyFiles(),
    sessions: collectSessions(),
    news: collectNews(),
    lint: collectLint(),
    cli: collectCli(),
    hooks: collectHooks(),
    knowledge,
    compile: collectCompile(),
    tasks: collectTasks(),
    context: await collectContext(),
    settings: collectSettings(),
    logs: collectLogs(),
    reports: allReports.slice(0, MAX_REPORTS),
    reportsTotal: allReports.length,
    radarLatest: await collectRadarLatest(allReports),
    changelog: parseChangelog()
  };
  return { ...base, health: computeHealth(base) };
};
