// Pure data, no 'claude-code' import: the features register their commands from here, and the
// dashboard's Capabilities page reads the same list, so the two can't drift.

export interface ModCommand {
  name: string;
  description: string;
  argumentHint?: string;
  immediate?: boolean;
}

export interface ModFeature {
  /** The feature's folder under mods/, which register.ts imports. */
  id: string;
  title: string;
  summary: string;
  where: string;
  commands: readonly ModCommand[];
  tools: readonly string[];
}

export const COMMANDS_FEATURE = {
  id: 'commands',
  title: 'Instant commands',
  summary: 'Capture a thought, log a lesson, close a task or see today, answered at once without a model turn.',
  where: 'slash commands',
  commands: [
    {
      name: 'capture',
      description: 'Drop a thought into the knowledge inbox (no Claude turn)',
      argumentHint: '<text>',
      immediate: true
    },
    {
      name: 'lesson',
      description: 'Log a correction to the feedback log (no Claude turn)',
      argumentHint: '<text>',
      immediate: true
    },
    { name: 'done', description: 'Close a task by id (no Claude turn)', argumentHint: '<task-id>', immediate: true },
    { name: 'today', description: "Overdue work, what's due today and the last sync (no Claude turn)" }
  ],
  tools: []
} as const satisfies ModFeature;

export const MANUALS_FEATURE = {
  id: 'manuals',
  title: 'Repo manuals',
  summary:
    "The first file read or written in a granted code repo, or named by absolute path in a shell command, attaches that repo's CLAUDE.md or AGENTS.md, once, and again after a compaction or /clear.",
  where: 'tool results · a 📎 line above the prompt',
  commands: [{ name: 'manuals', description: 'Repo instructions attached to this conversation (no Claude turn)' }],
  tools: []
} as const satisfies ModFeature;

export const SYNC_FEATURE = {
  id: 'sync',
  title: 'Sync progress',
  summary:
    "Sync's step, elapsed time and what it is clearing, live while it runs; its report quotes counted numbers instead of a tally.",
  where: 'above the prompt',
  commands: [],
  tools: ['sync_stats']
} as const satisfies ModFeature;

export const NOTICES_FEATURE = {
  id: 'notices',
  title: 'Notices',
  summary:
    'The top upgrade or sync nudge, with a button that runs it and one that snoozes it until tomorrow; also the Tab suggestion.',
  where: 'above the prompt · toast for an alert',
  commands: [],
  tools: []
} as const satisfies ModFeature;

export const MOD_FEATURES: readonly ModFeature[] = [COMMANDS_FEATURE, MANUALS_FEATURE, SYNC_FEATURE, NOTICES_FEATURE];
