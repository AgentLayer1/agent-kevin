#!/usr/bin/env bun
/**
 * The brain pass's decay inventory: stale and dormant tasks, dormant projects, memory-index lines
 * worth a question, archived decisions no pass has settled, stale articles, and old captures.
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
if (homeFlag) {
  process.env[agentKeyName('HOME')] = resolve(homeFlag);
}
// Read-only means no log file either: a scanner warning would otherwise write into the home.
process.env[agentKeyName('LOG_FILE')] = 'off';
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
const DECISION_DAYS = 45;
const CAPTURE_DAYS = 30;
const SESSION_WINDOW_DAYS = 90;
const TASK_ID = /\b[a-z]{2}-\d{3}\b/g;

const isDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);
const age = (date: string): number | null => (isDate(date) ? daysBetween(date, TODAY) : null);
const read = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf-8').replace(/\r\n/g, '\n') : '');
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
/** Any answer settles an item for 90 days, whatever it was. */
const settled = (key: string): boolean => {
  const sinceAsked = age(watermark.asked?.[key]?.date ?? '');
  return sinceAsked !== null && sinceAsked < KEEP_QUIET_DAYS;
};
/** A Keep settles an item only while its text is unchanged. */
const keptQuiet = (key: string, currentHash = ''): boolean => {
  const entry = watermark.asked?.[key];
  return entry?.answer === 'keep' && settled(key) && (entry.hash ?? '') === currentHash;
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
// Each day's operator words, once: ids and slugs are runs of word characters and hyphens, so set
// membership is the whole-word match (`tax` never hits "syntax") without rescanning every day per item.
const wordsByDay = windowDays.map((day) => ({
  day,
  words: new Set(
    userTurns(read(join(FOLDERS.SESSIONS, `${day}.md`)))
      .toLowerCase()
      .match(/[\w-]+/g) ?? []
  )
}));
/** Newest day an operator turn names any of `names` as a whole word, or null within the window. */
const lastMention = (names: string[]): string | null => {
  const wanted = names.filter((name) => name.length > 0).map((name) => name.toLowerCase());
  return wordsByDay.findLast(({ words }) => wanted.some((name) => words.has(name)))?.day ?? null;
};
const quietFor = (mention: string | null, days: number): boolean =>
  mention === null || (age(mention) ?? Infinity) >= days;

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
    key: `task:${task.id}`,
    hash: '',
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
const staleTasks = byOldest(
  openTasks
    .filter((task) => (age(task.updated) ?? Infinity) >= STALE_DAYS && !keptQuiet(`task:${task.id}`))
    .map(taskRow)
);
const activeOld = byOldest(
  openTasks
    .filter(
      (task) =>
        task.status === 'active' &&
        (age(task.created) ?? 0) >= ACTIVE_OLD_DAYS &&
        (age(task.updated) ?? Infinity) < STALE_DAYS &&
        !keptQuiet(`task:${task.id}`)
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
      key: `project:${slug}`,
      hash: '',
      slug,
      openTasks: own.filter((task) => openTasks.includes(task)).length,
      lastTaskUpdate,
      lastMention: lastMention([slug, ...own.map((task) => task.id)])
    };
  })
  .filter((project) => quietFor(project.lastTaskUpdate, DORMANT_DAYS) && quietFor(project.lastMention, DORMANT_DAYS));

// Memory index: every line of the sections loaded into each session, strongest signal first. A line
// with no task reference is still a candidate; verification decides whether it gets asked.
const memoryIndex = read(join(FOLDERS.MEMORY, 'index.md'));
const section = (name: string): string[] =>
  (memoryIndex.split(/^## /m).find((part) => part.startsWith(`${name}\n`)) ?? '')
    .split('\n')
    .filter((line) => line.startsWith('- '));
const memoryRow = (name: string) => (line: string) => {
  const lineHash = hash(line);
  const ids = [...new Set(line.match(TASK_ID) ?? [])].filter((id) => knownIds.has(id));
  const mention = ids.length > 0 ? lastMention(ids) : null;
  const signal =
    ids.length > 0 && ids.every((id) => closedIds.has(id))
      ? 'closed'
      : ids.length > 0 && quietFor(mention, QUIET_THREAD_DAYS)
        ? 'quiet'
        : 'none';
  return { key: `memory:${name}:${lineHash}`, hash: lineHash, text: line, ids, lastMention: mention, signal };
};
const SIGNAL_ORDER = ['closed', 'quiet', 'none'];
const memoryLines = (name: string) =>
  section(name)
    .map(memoryRow(name))
    .filter((row) => !keptQuiet(row.key, row.hash))
    .toSorted((left, right) => SIGNAL_ORDER.indexOf(left.signal) - SIGNAL_ORDER.indexOf(right.signal));
const openQuestions = memoryLines('Open Questions').filter((row) => row.text.includes('[stale]'));

// Archived decisions from the last 45 days that no pass has settled yet. The archive is permanent;
// the window is shorter than `asked` keeps an answer, so a settled decision never comes back, and
// one monthly pass plus a two-week grace covers every decision once.
const since = watermark.brainLastRun && isDate(watermark.brainLastRun) ? watermark.brainLastRun : '';
const archiveDir = join(FOLDERS.MEMORY, 'archive');
const archivedDecisions = (existsSync(archiveDir) ? readdirSync(archiveDir) : [])
  .filter((name) => /^decisions-\d{4}-\d{2}\.md$/.test(name))
  .flatMap((name) =>
    read(join(archiveDir, name))
      .split('\n')
      .map((line) => ({
        key: `decision:${hash(line)}`,
        hash: hash(line),
        file: name,
        date: line.match(/^- (?:\*\*)?(\d{4}-\d{2}-\d{2})(?:\*\*)? —/)?.[1] ?? '',
        text: line
      }))
  )
  .filter((entry) => entry.date !== '' && (age(entry.date) ?? Infinity) < DECISION_DAYS && !settled(entry.key))
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
      key: `article:${relative(FOLDERS.HOME, path)}`,
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
  .filter((article) => !keptQuiet(article.key, article.hash))
  .toSorted((left, right) => left.updated.localeCompare(right.updated));

// Dot-paths are skipped, as the inbox lister does: secrets live there and a sandbox may deny them.
const filesUnder = (path: string): string[] =>
  statSync(path).isDirectory()
    ? readdirSync(path)
        .filter((name) => !name.startsWith('.'))
        .flatMap((name) => filesUnder(join(path, name)))
    : [path];
const sizeOf = (path: string): number => filesUnder(path).reduce((sum, file) => sum + statSync(file).size, 0);
// Old captures, one group per month: a question per file would drown the interview, and the
// group's exact paths are what a yes deletes.
const capturesDir = join(FOLDERS.REPORTS, 'captures');
const oldCaptures = (existsSync(capturesDir) ? readdirSync(capturesDir).filter((name) => !name.startsWith('.')) : [])
  .map((name) => {
    const path = join(capturesDir, name);
    const folder = statSync(path).isDirectory();
    // A folder is as old as its newest file: a recording's frames and transcript land after it.
    const newest = Math.max(statSync(path).mtimeMs, ...filesUnder(path).map((file) => statSync(file).mtimeMs));
    return { path: relative(FOLDERS.HOME, path), folder, modified: todayDate(new Date(newest)), bytes: sizeOf(path) };
  })
  .filter((capture) => (age(capture.modified) ?? 0) >= CAPTURE_DAYS);
const captures = [...new Set(oldCaptures.map((capture) => capture.modified.slice(0, 7)))]
  .sort()
  .map((month) => {
    const group = oldCaptures.filter((capture) => capture.modified.startsWith(month));
    return {
      key: `capture:${month}`,
      hash: '',
      month,
      files: group
        .filter((capture) => !capture.folder)
        .map((capture) => capture.path)
        .sort(),
      folders: group
        .filter((capture) => capture.folder)
        .map((capture) => capture.path)
        .sort(),
      bytes: group.reduce((sum, capture) => sum + capture.bytes, 0)
    };
  })
  .filter((group) => !keptQuiet(group.key));

const memory = {
  threads: memoryLines('Active Threads'),
  pending: memoryLines('Pending'),
  keyContext: memoryLines('Key Context'),
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
  storage: { captures },
  counts: {
    staleTasks: staleTasks.length,
    dormantTasks: staleTasks.filter((task) => task.dormant).length,
    activeOld: activeOld.length,
    dormantProjects: dormantProjects.length,
    memoryLines:
      [...memory.threads, ...memory.keyContext].filter((row) => row.signal !== 'none').length +
      memory.pending.length +
      openQuestions.length,
    decisions: archivedDecisions.length,
    staleArticles: staleArticles.length,
    oldCaptureFiles: captures.reduce((sum, group) => sum + group.files.length + group.folders.length, 0),
    oldestWaiting
  }
};
process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
