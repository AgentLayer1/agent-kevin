import type {
  BrainCounts,
  CompileBacklog,
  SyncActions,
  SyncHistoryEntry,
  SyncRun,
  SyncSnapshot,
  TaskHealth
} from '../types';
import { PHASES } from './phases';

const HISTORY_LIMIT = 20;

const NO_ACTIONS: SyncActions = {
  reposUpdated: 0,
  compiled: 0,
  lintFixed: 0,
  lintErrors: 0,
  tasksClosed: 0,
  tasksUpdated: 0,
  threads: 0,
  tasksCreated: 0
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const isRecord = (data: unknown): data is Record<string, unknown> => typeof data === 'object' && data !== null;

const count = (data: unknown): number => (Array.isArray(data) ? data.length : typeof data === 'number' ? data : 0);

export const parseCompile = (text: string): CompileBacklog | null => {
  const data = parseJson(text);
  if (!isRecord(data) || !isRecord(data.pending)) {
    return null;
  }
  return {
    sessions: count(data.pending.sessions),
    feedback: count(data.pending.feedback),
    inbox: count(data.pending.inbox)
  };
};

export const parseTasks = (text: string): TaskHealth | null => {
  const data = parseJson(text);
  if (!isRecord(data)) {
    return null;
  }
  return { overdue: count(data.overdue), stale: count(data.stale), dueSoon: count(data.dueSoon) };
};

export const parseBrain = (text: string): BrainCounts | null => {
  const data = parseJson(text);
  if (!isRecord(data) || !isRecord(data.counts)) {
    return null;
  }
  const counts = data.counts;
  return {
    staleTasks: count(counts.staleTasks),
    dormantTasks: count(counts.dormantTasks),
    activeOld: count(counts.activeOld),
    dormantProjects: count(counts.dormantProjects),
    memoryLines: count(counts.memoryLines),
    decisions: count(counts.decisions),
    staleArticles: count(counts.staleArticles),
    oldCaptureFiles: count(counts.oldCaptureFiles),
    oldestWaiting: typeof counts.oldestWaiting === 'string' ? counts.oldestWaiting : null
  };
};

/**
 * Adds what one finished tool call did to the run's tally.
 */
const tallyAction = (actions: SyncActions, name: string, resultText: string): SyncActions => {
  const data = parseJson(resultText);
  switch (name) {
    case 'github_fast_forward':
      return { ...actions, reposUpdated: actions.reposUpdated + (resultText.match(/"UPDATED"/g) ?? []).length };
    case 'compile_write':
      return { ...actions, compiled: actions.compiled + 1 };
    case 'knowledge_lint':
      return isRecord(data)
        ? { ...actions, lintFixed: actions.lintFixed + count(data.fixed), lintErrors: count(data.errors) }
        : actions;
    case 'task_close':
      return { ...actions, tasksClosed: actions.tasksClosed + 1 };
    case 'task_update':
      return { ...actions, tasksUpdated: actions.tasksUpdated + 1 };
    case 'task_thread':
      return { ...actions, threads: actions.threads + 1 };
    case 'task_create':
      return { ...actions, tasksCreated: actions.tasksCreated + 1 };
    default:
      return actions;
  }
};

export const startRun = (now: number, before: SyncSnapshot | null): SyncRun => ({
  status: 'running',
  startedAt: now,
  phase: -1,
  phaseStartedAt: now,
  timings: [],
  actions: NO_ACTIONS,
  before,
  after: null,
  endedAt: null
});

const closePhase = (run: SyncRun, now: number): SyncRun =>
  run.phase < 0
    ? run
    : {
        ...run,
        timings: [...run.timings, { phase: PHASES[run.phase]?.id ?? 'unknown', ms: now - run.phaseStartedAt }]
      };

/**
 * Moves the run forward to `phase`; a call from an earlier phase never moves it back.
 */
const advance = (run: SyncRun, phase: number | undefined, now: number): SyncRun =>
  phase === undefined || phase <= run.phase ? run : { ...closePhase(run, now), phase, phaseStartedAt: now };

/**
 * A question is open: the run waits on the person, at the question's own phase.
 */
export const markWaiting = (run: SyncRun, phase: number | undefined, now: number): SyncRun => ({
  ...advance(run, phase, now),
  status: 'waiting'
});

/**
 * Applies one finished call: the phase it belongs to, and what it did unless it errored.
 */
export const recordCall = (
  run: SyncRun,
  call: { phase: number | undefined; name: string; resultText: string; isError: boolean },
  now: number
): SyncRun => ({
  ...advance(run, call.phase, now),
  status: 'running',
  actions: call.isError ? run.actions : tallyAction(run.actions, call.name, call.resultText)
});

/**
 * Ends the run with its final measurement; an interrupted run is `stopped`, not `done`.
 */
export const finish = (run: SyncRun, now: number, after: SyncSnapshot | null, isAborted: boolean): SyncRun => ({
  ...closePhase(run, now),
  status: isAborted ? 'stopped' : 'done',
  after: after ?? run.after,
  endedAt: now
});

export const isOver = (run: SyncRun): boolean => run.endedAt !== null;

export const toHistory = (run: SyncRun): SyncHistoryEntry => ({
  endedAt: run.endedAt ?? run.startedAt,
  totalMs: (run.endedAt ?? run.startedAt) - run.startedAt,
  after: run.after
});

export const appendHistory = (history: readonly SyncHistoryEntry[], entry: SyncHistoryEntry): SyncHistoryEntry[] =>
  [...history, entry].slice(-HISTORY_LIMIT);

export const parseHistory = (stored: unknown): SyncHistoryEntry[] =>
  Array.isArray(stored)
    ? stored.filter((entry): entry is SyncHistoryEntry => isRecord(entry) && 'totalMs' in entry)
    : [];

export const averageMs = (history: readonly SyncHistoryEntry[]): number | null =>
  history.length ? Math.round(history.reduce((sum, entry) => sum + entry.totalMs, 0) / history.length) : null;

/**
 * The store key the finished runs are kept under, read by any feature that quotes a typical sync.
 */
export const SYNC_HISTORY_KEY = 'sync-history';

/**
 * One run is a sample, not a typical time.
 */
export const typicalMs = (history: readonly SyncHistoryEntry[]): number | null =>
  history.length > 1 ? averageMs(history) : null;

const backlogTotal = (backlog: CompileBacklog | null): number | null =>
  backlog === null ? null : backlog.sessions + backlog.feedback + backlog.inbox;

/**
 * What the `sync_stats` tool answers: counted numbers the report quotes instead of a tally.
 */
export const statsPayload = (run: SyncRun, now: number, history: readonly SyncHistoryEntry[]) => {
  const last = history.at(-1);
  return {
    elapsedMs: now - run.startedAt,
    phase: PHASES[run.phase]?.id ?? null,
    phaseTimings: run.timings,
    actions: run.actions,
    compileBacklog: {
      before: backlogTotal(run.before?.compile ?? null),
      after: backlogTotal(run.after?.compile ?? null)
    },
    tasks: { before: run.before?.tasks ?? null, after: run.after?.tasks ?? null },
    brain: { before: run.before?.brain ?? null, after: run.after?.brain ?? null },
    lastRun: last
      ? { endedAt: new Date(last.endedAt).toISOString(), totalMs: last.totalMs, brain: last.after?.brain ?? null }
      : null,
    averageMs: averageMs(history)
  };
};

export const formatDuration = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
};

/**
 * How much of a starting count the run has cleared so far, and how far it grew if it did.
 */
export interface SubProgress {
  label: string;
  cleared: number;
  total: number;
  grew: number;
}

const subProgress = (label: string, before: number | null | undefined, now: number | null | undefined) => {
  if (before === null || before === undefined) {
    return null;
  }
  const latest = now ?? before;
  return { label, cleared: Math.max(0, before - latest), total: before, grew: Math.max(0, latest - before) };
};

/**
 * The band's counters, each measured against the run's start; counts that began at zero and
 * stayed there are left out.
 */
export const progressOf = (run: SyncRun): SubProgress[] =>
  [
    subProgress('sessions', run.before?.compile?.sessions, run.after?.compile?.sessions),
    subProgress('feedback', run.before?.compile?.feedback, run.after?.compile?.feedback),
    subProgress('inbox', run.before?.compile?.inbox, run.after?.compile?.inbox),
    subProgress('stale', run.before?.brain?.staleTasks, run.after?.brain?.staleTasks),
    subProgress('overdue', run.before?.tasks?.overdue, run.after?.tasks?.overdue)
  ].filter((item): item is SubProgress => item !== null && (item.total > 0 || item.grew > 0));

/**
 * What the run did, for the band's tail.
 */
export const actionNotes = (actions: SyncActions): { label: string; count: number }[] =>
  [
    { label: 'compiled', count: actions.compiled },
    { label: 'lint fixed', count: actions.lintFixed },
    { label: 'closed', count: actions.tasksClosed }
  ].filter((item) => item.count > 0);

/**
 * A fresh partial measurement laid over the latest one.
 */
export const remeasured = (run: SyncRun, fresh: Partial<SyncSnapshot>): SyncRun => ({
  ...run,
  after: { compile: null, tasks: null, brain: null, ...(run.after ?? run.before), ...fresh }
});

/**
 * The paragraph appended to sync's prompt when the stats tool is registered.
 */
export const statsInstruction = (toolName: string): string =>
  [
    '',
    '## Counted numbers (this session)',
    '',
    `Before writing the output block, call \`${toolName}\` once and quote its numbers for the compile backlog, the 🧹 Brain counts, task health and timing, instead of tallying them yourself. Its \`before\`/\`after\` pairs are measured at the start of this run and at the call.`
  ].join('\n');
