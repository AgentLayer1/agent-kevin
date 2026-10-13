export interface AgendaItem {
  id: string;
  priority: string;
  title: string;
  daysLate: number;
}

export interface TodayView {
  emoji: string;
  dateLabel: string;
  hijriLabel: string;
  overdue: AgendaItem[];
  dueToday: AgendaItem[];
  syncAgeHours: number | null;
}

export interface CompileBacklog {
  sessions: number;
  feedback: number;
  inbox: number;
}

export interface TaskHealth {
  overdue: number;
  stale: number;
  dueSoon: number;
}

export interface BrainCounts {
  staleTasks: number;
  dormantTasks: number;
  activeOld: number;
  dormantProjects: number;
  memoryLines: number;
  decisions: number;
  staleArticles: number;
  oldCaptureFiles: number;
  brokenPins: number;
  staleSurfaces: number;
  oldestWaiting: string | null;
}

export interface SyncSnapshot {
  compile: CompileBacklog | null;
  tasks: TaskHealth | null;
  brain: BrainCounts | null;
}

export interface SyncActions {
  reposUpdated: number;
  compiled: number;
  lintFixed: number;
  lintErrors: number;
  tasksClosed: number;
  tasksUpdated: number;
  threads: number;
  tasksCreated: number;
}

export interface PhaseTiming {
  phase: string;
  ms: number;
}

export interface SyncRun {
  status: 'running' | 'waiting' | 'done' | 'stopped';
  startedAt: number;
  phase: number;
  phaseStartedAt: number;
  timings: PhaseTiming[];
  actions: SyncActions;
  before: SyncSnapshot | null;
  after: SyncSnapshot | null;
  endedAt: number | null;
  /** The loop that loaded sync; the run ends with one of its turns. */
  owner: string;
  /** The loops doing the sync: the owner and every agent spawned from one of them. */
  loops: string[];
}

export interface SyncHistoryEntry {
  endedAt: number;
  totalMs: number;
  after: SyncSnapshot | null;
}

/**
 * One entry the CLI's `notices` prints, mirrored from mcp-server/src/notices/notices.ts (a mod can't import Node code).
 */
export interface NoticeFact {
  text: string;
  tone?: 'accent' | 'warn';
}

export interface Notice {
  id: string;
  level: 'hint' | 'nudge' | 'alert';
  pinned: boolean;
  icon: string;
  label: string;
  title: string;
  facts: NoticeFact[];
  command: string;
  actionLabel: string;
}

/**
 * A notice whose command was pressed (`isStarted` false until its skill starts) or is running.
 */
export interface NoticeActing {
  id: string;
  isStarted: boolean;
  at: number;
}

/**
 * A report this conversation wrote, edited or attached, as the store keeps it.
 */
export interface SessionReport {
  title: string;
  path: string;
}

/**
 * One row of the /reports band: the page beside the card when there is one, else the card.
 */
export interface ReportRow {
  title: string;
  shownPath: string;
}

export interface Queue {
  pending: string[];
  isBusy: boolean;
  /** Set when a turn was stopped or failed; the next turn that ends normally resumes the queue. */
  isPaused: boolean;
}

declare module 'claude-code' {
  interface PluginState {
    'agent-kevin': {
      syncRun: SyncRun | null;
      delivered: string[];
      manualsThisTurn: string[];
      todayBand: TodayView | null;
      reportsBand: ReportRow[] | null;
      syncTick: number;
      notices: Notice[];
      noticeActing: NoticeActing | null;
      queue: Queue;
      needsSetup: boolean;
    };
  }
}
