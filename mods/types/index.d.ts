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
}

export interface SyncHistoryEntry {
  endedAt: number;
  totalMs: number;
  after: SyncSnapshot | null;
}

declare module 'claude-code' {
  interface PluginState {
    'agent-kevin': {
      syncRun: SyncRun | null;
      delivered: string[];
      manualsThisTurn: string[];
      todayViews: Record<string, TodayView>;
      syncTick: number;
    };
  }
}
