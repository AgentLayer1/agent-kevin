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

declare module 'claude-code' {
  interface PluginState {
    'agent-kevin': { todayViews: Record<string, TodayView> };
  }
}
