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
import { FILES, FOLDERS, MARKDOWN_URL, PLUGIN_NAME, TIMEZONE } from '@/config';
import { contextManifest, type ManifestEntry } from '@/context';
import { nowTime } from '@/shared/date';
import type { TaskFile } from '@/shared/types';
import { discoverProjects, scanAllTasks } from '@/tasks/scan';
import { resolveTasks } from '@/tasks/resolve';
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

export interface CompileEntry {
  day: string;
  cost: number;
  at: string;
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
}

export interface SkillInfo {
  name: string;
  description: string;
  custom: boolean;
  /** True when the model may auto-invoke it (no `disable-model-invocation`). */
  auto: boolean;
}

export interface ToolInfo {
  name: string;
  description: string;
}

/** One captured working session from raw/sessions/index.json. */
export interface SessionRef {
  id: string;
  firstSeen: string;
  lastSeen: string;
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
  url: string;
  /** `(Source, Mon D)` annotation following the link; '' if absent. */
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
  roles: string[];
  soulTraits: string[];
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
  stale: number;
  pendingCompiles: number;
  logErrors: number;
  missingImports: number;
  ok: boolean;
}

export type ContextGroup = 'instructions' | 'identity' | 'facets' | 'knowledge' | 'tasks' | 'other';

export interface SessionDay {
  day: string;
  label: string;
  bytes: number;
}

export interface StaticImport {
  label: string;
  bytes: number;
  present: boolean;
  group: ContextGroup;
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
    knowledgePath: string;
    projectsPath: string;
    reportsPath: string;
    statePath: string;
    logsPath: string;
    timezone: string;
    date: string;
    /** Today as YYYY-MM-DD in TIMEZONE — anchor for due-date grouping. */
    isoDate: string;
    time: string;
  };
  persona: Persona;
  operator: OperatorInfo;
  /** URL template for opening markdown files, `{path}` = encoded abs path.
   *  Configurable via the MARKDOWN_URL env var (settings.local.json `env`). */
  markdownUrl: string;
  skills: { count: number; names: string[]; custom: number; details: SkillInfo[] };
  mcp: { servers: string[]; toolCount: number; tools: string[]; toolDetails: ToolInfo[] };
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
  hooks: { events: string[]; count: number; entries: HookEntry[] };
  knowledge: {
    concepts: number;
    conceptNames: string[];
    /** Concepts joined with their one-line descriptions from knowledge/index.md. */
    conceptDetails: ConceptInfo[];
    userFacets: number;
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
    recent: CompileEntry[];
  };
  tasks: {
    active: number;
    blocked: number;
    open: number;
    stale: number;
    overdue: number;
    total: number;
    projects: number;
    byProject: ProjectLoad[];
    overdueList: TaskRef[];
    staleList: TaskRef[];
    activeList: TaskRef[];
    /** Every open/active/blocked task — the dashboard derives agenda groups. */
    queue: TaskRef[];
    /** Any task (any status) whose `updated:` is today — the activity trail. */
    touchedToday: TaskRef[];
  };
  context: {
    source: string;
    staticImports: StaticImport[];
    staticBytes: number;
    dynamic: { date: string; entries: ManifestEntry[]; bytes: number };
  };
  settings: {
    layers: SettingsLayer[];
    allow: number;
    deny: number;
    env: EnvEntry[];
    enabledPlugins: string[];
    plugin: PluginRef | null;
  };
  logs: {
    path: string;
    bytes: number;
    mtime: string | null;
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
  health: Health;
}

const MARKDOWN_RE = /\.md$/;
const SECRET_KEY_RE =
  /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CRED|PRIVATE|OAUTH|SESSION|DB_URL|DB_URI|DATABASE|DSN|CONN|MCP_DB)/i;
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
  return {
    count: details.length,
    names: plugin.map((skill) => skill.name),
    custom: customs.length,
    details
  };
};

const collectMcp = async (): Promise<StatusSnapshot['mcp']> => {
  const servers = new Set<string>();
  for (const path of [resolve(FOLDERS.ROOT, '.mcp.json'), resolve(FOLDERS.HOME, '.mcp.json')]) {
    const parsed = readJson<{ mcpServers?: Record<string, unknown> }>(path);
    Object.keys(parsed?.mcpServers ?? {}).forEach((name) => servers.add(name));
  }
  const toolDetails = await collectMcpTools();
  return {
    servers: [...servers],
    toolCount: toolDetails.length,
    tools: toolDetails.map((tool) => tool.name),
    toolDetails
  };
};

/**
 * Authoritative tool list: gather the side-effect-free `tools` arrays exactly
 * as server.ts aggregates them. server.ts itself can't be imported (its
 * top-level `server.connect()` would start a server), so the module list is
 * mirrored here — keep in sync with server.ts's TOOLS assembly.
 */
const collectMcpTools = async (): Promise<ToolInfo[]> => {
  const modules = [
    'browser-flows',
    'capture',
    'compile',
    'google-page-speed',
    'google-search-console',
    'knowledge',
    'open-page-rank',
    'perplexity',
    'ping',
    'playwright',
    'reports',
    'serpapi',
    'status',
    'tasks'
  ];
  const lists = await Promise.all(
    modules.map(async (name) => {
      try {
        const mod = (await import(`@/tools/${name}`)) as {
          tools?: Array<{ name?: string; description?: string }>;
        };
        return (mod.tools ?? []).map((tool) => ({
          name: tool.name ?? '?',
          description: firstSentence(tool.description ?? '')
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
  const events = Object.keys(hookMap);
  const entries: HookEntry[] = events.map((event) => {
    const command = hookMap[event]?.[0]?.hooks?.[0]?.command ?? '';
    return { event, command: command ? summarizeHookCommand(command) : '—' };
  });
  return { events, count: events.length, entries };
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
    return {
      day: iso,
      label,
      bytes: safeBytes(resolve(FOLDERS.SESSIONS, `${iso}.md`))
    };
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
    conceptNames,
    conceptDetails: conceptNames.map((name) => ({
      name,
      description: conceptDescriptions.get(name) ?? '',
      href: `knowledge/concepts/${name}.md`
    })),
    userFacets: facets.length,
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
  const recent: CompileEntry[] = Object.entries(ingestedMap)
    .filter(([, entry]) => Boolean(entry.compiled_at))
    .sort(([, a], [, b]) => (b.compiled_at ?? '').localeCompare(a.compiled_at ?? ''))
    .slice(0, 7)
    .map(([file, entry]) => ({
      day: file.replace(MARKDOWN_RE, ''),
      cost: entry.cost_usd ?? 0,
      at: entry.compiled_at ?? ''
    }));
  return {
    ingested,
    sessionFiles,
    pending: Math.max(0, sessionFiles - ingested),
    lastCompiled,
    totalCostUsd,
    recent
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
  path: relative(FOLDERS.HOME, task.filePath)
});

const OPEN_STATUSES = new Set(['open', 'active', 'blocked']);

/** First plain paragraph of a project README (frontmatter skipped). */
const projectDescription = (project: string): string => firstParagraph(resolve(FOLDERS.PROJECTS, project, 'README.md'));

const collectTasks = (): StatusSnapshot['tasks'] => {
  const all = scanAllTasks();
  const scan = resolveTasks(all);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
  const byStatus = (status: string) => all.filter((task) => task.frontmatter.status === status).length;

  const projectMap = new Map<string, ProjectLoad>();
  for (const task of all) {
    const { project, status, updated } = task.frontmatter;
    const load = projectMap.get(project) ?? {
      project,
      open: 0,
      active: 0,
      blocked: 0,
      total: 0,
      done: 0,
      updatedAt: '',
      description: ''
    };
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
    .sort((a, b) => b.total - a.total);

  // Whole working set, P0 first then earliest due — the dashboard's agenda raw material.
  const queue = all
    .filter((task) => OPEN_STATUSES.has(task.frontmatter.status))
    .map(toRef)
    .sort((a, b) => a.priority.localeCompare(b.priority) || (a.due || '9999').localeCompare(b.due || '9999'));

  return {
    active: byStatus('active'),
    blocked: byStatus('blocked'),
    open: byStatus('open'),
    stale: scan.stale.length,
    overdue: scan.overdue.length,
    total: all.length,
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
      .map(toRef)
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
  const claudeChain: Array<{ label: string; path: string }> = [
    {
      label: '~/.claude/CLAUDE.md',
      path: resolve(homedir(), '.claude', 'CLAUDE.md')
    },
    { label: 'CLAUDE.md', path: FILES.CLAUDE },
    { label: 'CLAUDE.local.md', path: FILES.CLAUDE_LOCAL }
  ];
  const claudeImports: StaticImport[] = claudeChain
    .filter((entry) => existsSync(entry.path))
    .map((entry) => ({
      label: entry.label,
      bytes: safeBytes(entry.path),
      present: true,
      group: 'instructions' as const
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

  return { source, staticImports, staticBytes, dynamic };
};

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
    enabledPlugins: [...enabledPlugins],
    plugin
  };
};

// Anchor on the level field (right after the ISO-UTC timestamp) so a "WARN"/
// "ERROR" substring inside a message body never inflates the count.
const LEVEL_RE = /^\S+Z (WARN|ERROR) /;

/** Bytes of app.log surfaced in the System → Logs tab. */
const LOG_TAIL_BYTES = 24_000;

const collectLogs = (): StatusSnapshot['logs'] => {
  const path = resolve(FOLDERS.LOGS, 'app.log');
  let bytes = 0;
  let mtime: string | null = null;
  let warnings = 0;
  let errors = 0;
  let totalWarnings = 0;
  let totalErrors = 0;
  let lastError: string | null = null;
  let tail = '';
  try {
    const stat = statSync(path);
    bytes = stat.size;
    mtime = stat.mtime.toLocaleTimeString('en-GB', {
      timeZone: TIMEZONE,
      hour: '2-digit',
      minute: '2-digit'
    });
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
    mtime,
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

const collectPersona = (): Persona => ({
  name: boldField(FILES.IDENTITY, 'Name') || FALLBACK_AGENT_NAME,
  kind: stripMarkdown(boldField(FILES.IDENTITY, 'Kind')),
  vibe: stripMarkdown(boldField(FILES.IDENTITY, 'Vibe')),
  emoji: boldField(FILES.IDENTITY, 'Emoji'),
  avatar: firstImage(FILES.IDENTITY),
  bio: sectionText(FILES.IDENTITY, 'Short Bio'),
  roles: bulletsUnder(FILES.IDENTITY, 'Core Role').map(stripMarkdown),
  soulTraits: bulletsUnder(FILES.SOUL, 'Vibe').map(stripMarkdown)
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
    timezone: stripMarkdown(boldField(FILES.USER, 'Timezone')),
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
    .replace(/^\s*DO NOT respond.*$/i, '')
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

const collectSessions = (): SessionRef[] => {
  const parsed = readJson<{ sessions?: Record<string, SessionIndexRecord> }>(FILES.SESSION_INDEX);
  const cutoff = new Date(Date.now() - SESSION_WINDOW_DAYS * 86_400_000).toLocaleDateString('sv-SE', {
    timeZone: TIMEZONE
  });
  return Object.entries(parsed?.sessions ?? {})
    .map(([id, record]) => {
      const raw = (record.briefing ?? '').trim();
      return {
        id,
        firstSeen: record.first_seen ?? '',
        lastSeen: record.last_seen ?? record.first_seen ?? '',
        turns: record.captured_turns ?? 0,
        cwd: record.cwd ?? '',
        briefing: cleanBriefing(raw),
        isCommand: raw.startsWith('<command-') || raw.startsWith('/')
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

/** Harvest headline links from the News/Signals sections of the most recent
 *  briefing reports. Deduped by URL, newest briefing first. */
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
        inNews = true;
        continue;
      }
      // Any other section marker ends the news block.
      if (/^\s*(\*\*)?[👉🍌📋🎯⚙️🔄✅]/u.test(line.trim()) || /^#{1,3} /.test(line)) {
        inNews = false;
        continue;
      }
      if (!inNews) continue;
      const match = line.match(NEWS_LINK_RE);
      if (!match || seen.has(match[2])) continue;
      seen.add(match[2]);
      items.push({ date, title: stripMarkdown(match[1]), url: match[2], source: match[3] ?? '' });
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

const DEFAULT_MARKDOWN_URL = 'obsidian://open?path={path}';

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
  return {
    version: manifest?.version ?? '0.0.0',
    pluginName: manifest?.name ?? 'agent-kevin',
    home: FOLDERS.HOME,
    pluginRoot: FOLDERS.ROOT,
    knowledgePath: FOLDERS.KNOWLEDGE,
    projectsPath: FOLDERS.PROJECTS,
    reportsPath: FOLDERS.REPORTS,
    statePath: FOLDERS.DATA,
    logsPath: FOLDERS.LOGS,
    timezone: TIMEZONE,
    date: now.toLocaleDateString('en-GB', {
      timeZone: TIMEZONE,
      weekday: 'short',
      day: '2-digit',
      month: 'short'
    }),
    isoDate: now.toLocaleDateString('sv-SE', { timeZone: TIMEZONE }),
    time: nowTime(now)
  };
};

/** All report entries from reports/index.md (newest first), carrying the
 *  `## YYYY-MM-DD` day they were filed under and the index line's link/skill/
 *  status so the dashboard can render them clickable. */
const collectReports = (): ReportRef[] => {
  try {
    const refs: ReportRef[] = [];
    let day = '';
    for (const line of readFileSync(FILES.REPORTS_INDEX, 'utf-8').split('\n')) {
      const heading = line.match(/^## (\d{4}-\d{2}-\d{2})/);
      if (heading) {
        day = heading[1];
        continue;
      }
      const entry = line.match(/^- (\d{2}:\d{2}) · \[([^\]]+)\](?:\(([^)]+)\))?(?: · `([^`]+)`)?(?: · (\S+))?/);
      if (!entry) continue;
      refs.push({
        date: day,
        time: entry[1],
        title: entry[2],
        // Index links are relative to reports/; the dashboard sits at <HOME>.
        href: entry[3] ? `reports/${entry[3]}` : '',
        skill: entry[4] ?? '',
        status: entry[5] ?? ''
      });
    }
    return refs;
  } catch {
    return [];
  }
};

const TASKS_DASHBOARD = resolve(FOLDERS.PROJECTS, 'TASKS.md');

const collectGoals = (): StatusSnapshot['goals'] => ({
  weekly: sectionLines(TASKS_DASHBOARD, 'Weekly Goals').map(stripMarkdown),
  monthly: sectionLines(TASKS_DASHBOARD, 'Monthly Goals').map(stripMarkdown),
  yearly: sectionLines(TASKS_DASHBOARD, 'Yearly Goals').map(stripMarkdown)
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
    stale: snap.tasks.stale,
    pendingCompiles,
    logErrors,
    missingImports,
    ok: overdue === 0 && pendingCompiles === 0 && logErrors === 0 && missingImports === 0
  };
};

const MAX_REPORTS = 60;

export const collectStatus = async (): Promise<StatusSnapshot> => {
  const allReports = collectReports();
  const knowledge = collectKnowledge();
  const base = {
    runtime: collectRuntime(),
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
    reportsTotal: allReports.length
  };
  return { ...base, health: computeHealth(base) };
};
