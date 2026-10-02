#!/usr/bin/env bun
/**
 * The brain pass's decay inventory: stale and dormant tasks, dormant projects, memory-index lines
 * worth a question, decisions archived since the last brain pass, stale articles, and storage.
 * Every bucket is a date comparison or a count; the interview judges, this only detects. Read-only.
 *
 * Usage: brain-audit.ts [--home <dir>] [--today YYYY-MM-DD]   (else the agent's home variable, else the cwd)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { agentKeyName } from '../../../mcp-server/src/shared/naming';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const homeFlag = flag('--home');
// The config module resolves the home from the agent's own variable, so --home is exported first.
if (homeFlag) process.env[agentKeyName('HOME')] = resolve(homeFlag);
const { FOLDERS } = await import('../../../mcp-server/src/config');
const { agentHomePath, isAgentHome } = await import('../../../mcp-server/src/shared/env');
const { daysBetween, todayDate } = await import('../../../mcp-server/src/shared/date');
const { hashBuffer, splitFrontmatter } = await import('../../../mcp-server/src/knowledge/utils');
const { discoverProjects, scanAllTasks, scanArchivedTasks } = await import('../../../mcp-server/src/tasks/scan');

if (!isAgentHome(agentHomePath())) {
  console.error(`not an agent home: ${agentHomePath()}`);
  process.exit(2);
}

const TODAY = flag('--today') ?? todayDate();
const STALE_DAYS = 30;
const DORMANT_DAYS = 60;
const ACTIVE_OLD_DAYS = 60;
const QUIET_THREAD_DAYS = 14;
const KEEP_QUIET_DAYS = 90;
const CAPTURE_DAYS = 30;
const SESSION_WINDOW_DAYS = 90;
const TASK_ID = /\b[a-z]{2}-\d{3}\b/g;

const isDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);
const age = (date: string): number | null => (isDate(date) ? daysBetween(date, TODAY) : null);
const read = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf-8') : '');
const hash = (text: string): string => hashBuffer(text.trim().replace(/\s+/g, ' '));

interface Asked {
  date: string;
  answer: string;
  hash?: string;
}
interface Watermark {
  brainLastRun?: string;
  asked?: Record<string, Asked>;
}
const watermark: Watermark = (() => {
  try {
    return JSON.parse(read(join(FOLDERS.DATA, 'review.json')) || '{}') as Watermark;
  } catch {
    return {};
  }
})();
/** An item answered Keep stays quiet for 90 days, and only while its text is unchanged. */
const keptQuiet = (key: string, currentHash = ''): boolean => {
  const entry = watermark.asked?.[key];
  if (!entry || entry.answer !== 'keep') return false;
  const sinceAsked = age(entry.date);
  return sinceAsked !== null && sinceAsked < KEEP_QUIET_DAYS && (entry.hash ?? '') === currentHash;
};

// Operator mentions: whole-word hits inside `**User:**` turns of the dated session day-files.
const userTurns = (text: string): string =>
  text
    .split(/^(?=\*\*(?:User|Assistant):\*\*)/m)
    .filter((turn) => turn.startsWith('**User:**'))
    .join('\n');
const sessionDays = (existsSync(FOLDERS.SESSIONS) ? readdirSync(FOLDERS.SESSIONS) : [])
  .map((name) => name.match(/^(\d{4}-\d{2}-\d{2})\.md$/)?.[1] ?? '')
  .filter((day) => day !== '' && day <= TODAY)
  .sort();
const windowDays = sessionDays.filter((day) => (age(day) ?? Infinity) <= SESSION_WINDOW_DAYS);
const turnsByDay = windowDays.map((day) => ({ day, text: userTurns(read(join(FOLDERS.SESSIONS, `${day}.md`))) }));
const escape = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Newest day an operator turn names any of `words` as a whole word, or null within the window. */
const lastMention = (words: string[]): string | null => {
  const patterns = words
    .filter((word) => word.length > 0)
    .map((word) => new RegExp(`(?<![\\w-])${escape(word)}(?![\\w-])`, 'i'));
  return turnsByDay.findLast(({ text }) => patterns.some((pattern) => pattern.test(text)))?.day ?? null;
};
const quietFor = (mention: string | null, days: number): boolean =>
  mention === null || (age(mention) ?? Infinity) >= days;

// Tasks.
const tasks = scanAllTasks().map((task) => task.frontmatter);
const closedIds = new Set([
  ...scanArchivedTasks().map((task) => task.frontmatter.id),
  ...tasks.filter((task) => task.status === 'done' || task.status === 'cancelled').map((task) => task.id)
]);
const openTasks = tasks.filter(
  (task) => task.status === 'open' || task.status === 'active' || task.status === 'blocked'
);
const knownIds = new Set([...closedIds, ...openTasks.map((task) => task.id)]);
const taskRow = (task: (typeof openTasks)[number]) => {
  const mention = lastMention([task.id]);
  return {
    id: task.id,
    title: task.title,
    project: task.project,
    status: task.status,
    priority: task.priority,
    due: task.due,
    created: task.created,
    updated: task.updated,
    daysSinceUpdate: age(task.updated),
    lastMention: mention,
    dormant: quietFor(mention, DORMANT_DAYS)
  };
};
const byOldest = <Row extends { updated: string }>(rows: Row[]): Row[] =>
  rows.toSorted((left, right) => left.updated.localeCompare(right.updated));
const staleTasks = byOldest(openTasks.filter((task) => (age(task.updated) ?? Infinity) >= STALE_DAYS).map(taskRow));
const activeOld = byOldest(
  openTasks
    .filter(
      (task) =>
        task.status === 'active' &&
        (age(task.created) ?? 0) >= ACTIVE_OLD_DAYS &&
        (age(task.updated) ?? Infinity) < STALE_DAYS
    )
    .map(taskRow)
);

// Projects: no task touched and no operator mention of the slug or any of its ids for 60 days.
const dormantProjects = discoverProjects()
  .filter((slug) => !keptQuiet(`project:${slug}`))
  .map((slug) => {
    const own = tasks.filter((task) => task.project === slug);
    const lastTaskUpdate =
      own
        .map((task) => task.updated)
        .filter(isDate)
        .sort()
        .at(-1) ?? null;
    return {
      slug,
      openTasks: own.filter((task) => openTasks.includes(task)).length,
      lastTaskUpdate,
      lastMention: lastMention([slug, ...own.map((task) => task.id)])
    };
  })
  .filter((project) => quietFor(project.lastTaskUpdate, DORMANT_DAYS) && quietFor(project.lastMention, DORMANT_DAYS));

// Memory index: Active Threads and Key Context lines with a closed-or-quiet signal; every Pending line.
const memoryIndex = read(join(FOLDERS.MEMORY, 'index.md'));
const section = (name: string): string[] =>
  (memoryIndex.split(/^## /m).find((part) => part.startsWith(`${name}\n`)) ?? '')
    .split('\n')
    .filter((line) => line.startsWith('- '));
const memoryRow = (name: string) => (line: string) => {
  const ids = [...new Set(line.match(TASK_ID) ?? [])].filter((id) => knownIds.has(id));
  const mention = ids.length > 0 ? lastMention(ids) : null;
  const signal =
    ids.length > 0 && ids.every((id) => closedIds.has(id))
      ? 'closed'
      : ids.length > 0 && quietFor(mention, QUIET_THREAD_DAYS)
        ? 'quiet'
        : 'none';
  return { key: `memory:${name}:${hash(line)}`, text: line, ids, lastMention: mention, signal };
};
const memoryLines = (name: string, keepAll: boolean) =>
  section(name)
    .map(memoryRow(name))
    .filter((row) => (keepAll || row.signal !== 'none') && !keptQuiet(row.key, hash(row.text)));
const openQuestions = section('Open Questions').filter((line) => line.includes('[stale]'));

// Decisions archived after the last brain pass (the archive is permanent; only dated daily files prune).
const since = watermark.brainLastRun && isDate(watermark.brainLastRun) ? watermark.brainLastRun : '';
const archiveDir = join(FOLDERS.MEMORY, 'archive');
const archivedDecisions = (existsSync(archiveDir) ? readdirSync(archiveDir) : [])
  .filter((name) => /^decisions-\d{4}-\d{2}\.md$/.test(name))
  .flatMap((name) =>
    read(join(archiveDir, name))
      .split('\n')
      .map((line) => ({ file: name, date: line.match(/^- \*\*(\d{4}-\d{2}-\d{2})\*\*/)?.[1] ?? '', text: line }))
  )
  .filter((entry) => entry.date !== '' && entry.date > since && (since !== '' || (age(entry.date) ?? Infinity) <= 31))
  .toSorted((left, right) => left.date.localeCompare(right.date));

// Articles: concepts and user facets untouched for 60 days and unmentioned by slug for 60.
const articleDirs = [FOLDERS.CONCEPTS, FOLDERS.USER_KNOWLEDGE];
const staleArticles = articleDirs
  .flatMap((dir) =>
    existsSync(dir)
      ? readdirSync(dir)
          .filter((name) => name.endsWith('.md'))
          .map((name) => join(dir, name))
      : []
  )
  .map((path) => {
    const content = read(path);
    const updated = splitFrontmatter(content).frontmatter.match(/^updated:\s*['"]?(\d{4}-\d{2}-\d{2})/m)?.[1] ?? '';
    const slug = basename(path, '.md');
    return {
      path: relative(FOLDERS.HOME, path),
      updated,
      daysSinceUpdate: age(updated),
      lastMention: lastMention([slug]),
      hash: hash(content)
    };
  })
  .filter(
    (article) => (article.daysSinceUpdate ?? Infinity) >= DORMANT_DAYS && quietFor(article.lastMention, DORMANT_DAYS)
  )
  .filter((article) => !keptQuiet(`article:${article.path}`, article.hash))
  .toSorted((left, right) => left.updated.localeCompare(right.updated));

// Storage.
// Dot-paths are skipped, as the inbox lister does: secrets live there and a sandbox may deny them.
const filesUnder = (path: string): string[] =>
  statSync(path).isDirectory()
    ? readdirSync(path)
        .filter((name) => !name.startsWith('.'))
        .flatMap((name) => filesUnder(join(path, name)))
    : [path];
const sizeOf = (path: string): number => filesUnder(path).reduce((sum, file) => sum + statSync(file).size, 0);
const reportDirs = existsSync(FOLDERS.REPORTS)
  ? readdirSync(FOLDERS.REPORTS).filter(
      (name) => !name.startsWith('.') && statSync(join(FOLDERS.REPORTS, name)).isDirectory()
    )
  : [];
const reports = Object.fromEntries(
  reportDirs.map((name) => {
    const dir = join(FOLDERS.REPORTS, name);
    return [name, { files: filesUnder(dir).length, bytes: sizeOf(dir) }];
  })
);
// Old captures, one group per month: a question per file would drown the interview, and the
// group's exact paths are what a yes deletes.
const capturesDir = join(FOLDERS.REPORTS, 'captures');
const oldCaptures = (existsSync(capturesDir) ? readdirSync(capturesDir).filter((name) => !name.startsWith('.')) : [])
  .map((name) => {
    const path = join(capturesDir, name);
    return { path: relative(FOLDERS.HOME, path), modified: todayDate(statSync(path).mtime), bytes: sizeOf(path) };
  })
  .filter((capture) => (age(capture.modified) ?? 0) >= CAPTURE_DAYS);
const captures = [...new Set(oldCaptures.map((capture) => capture.modified.slice(0, 7)))]
  .sort()
  .map((month) => {
    const group = oldCaptures.filter((capture) => capture.modified.startsWith(month));
    return {
      key: `capture:${month}`,
      month,
      paths: group.map((capture) => capture.path).sort(),
      bytes: group.reduce((sum, capture) => sum + capture.bytes, 0)
    };
  })
  .filter((group) => !keptQuiet(group.key));
const inbox = existsSync(FOLDERS.INBOX_RAW)
  ? readdirSync(FOLDERS.INBOX_RAW).filter((name) => !name.startsWith('.')).length
  : 0;

const memory = {
  threads: memoryLines('Active Threads', false),
  pending: memoryLines('Pending', true),
  keyContext: memoryLines('Key Context', false),
  openQuestions
};
const oldestWaiting = staleTasks[0]?.updated ?? null;
const audit = {
  today: TODAY,
  sessions: {
    days: windowDays.length,
    from: windowDays[0] ?? null,
    to: windowDays.at(-1) ?? null,
    oldest: sessionDays[0] ?? null
  },
  brainLastRun: since || null,
  tasks: { stale: staleTasks, activeOld },
  projects: { dormant: dormantProjects },
  memory,
  decisions: archivedDecisions,
  articles: staleArticles,
  storage: { reports, captures, inbox },
  counts: {
    staleTasks: staleTasks.length,
    dormantTasks: staleTasks.filter((task) => task.dormant).length,
    activeOld: activeOld.length,
    dormantProjects: dormantProjects.length,
    memoryLines: memory.threads.length + memory.pending.length + memory.keyContext.length + openQuestions.length,
    decisions: archivedDecisions.length,
    staleArticles: staleArticles.length,
    oldCaptureFiles: oldCaptures.length,
    oldestWaiting
  }
};
process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
