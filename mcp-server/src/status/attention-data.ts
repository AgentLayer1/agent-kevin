import { readJsonBlock } from '@/shared/json-block';
import { horizonBucket } from '@/tasks/horizon';
import { z } from 'zod';

export const ATTENTION_TONES = ['good', 'warn', 'bad', 'dim'] as const;

export const AttentionItemSchema = z.object({
  title: z.string(),
  url: z
    .string()
    .refine((url) => url === '' || /^https?:\/\//i.test(url), 'Queue links must be http(s)')
    .default(''),
  detail: z.string().default(''),
  tone: z.enum(ATTENTION_TONES).default('dim')
});

export const AttentionGroupSchema = z.object({
  label: z.string().min(1),
  empty: z.string().default('Nothing here.'),
  items: z.array(AttentionItemSchema).default([]),
  /** Why part or all of this source couldn't be read; shown once, never counted as an item. */
  unavailable: z.string().default('')
});

export const AttentionSnapshotSchema = z.object({
  fetchedAt: z.string(),
  groups: z.array(AttentionGroupSchema).default([])
});

export type AttentionItem = z.infer<typeof AttentionItemSchema>;
export type AttentionGroup = z.infer<typeof AttentionGroupSchema>;
export type AttentionSnapshot = z.infer<typeof AttentionSnapshotSchema>;

const AttentionTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  priority: z.string(),
  project: z.string(),
  status: z.string(),
  due: z.string(),
  horizon: z.string(),
  blockedBy: z.string(),
  /** HOME-relative, so a page never embeds a machine path. */
  path: z.string()
});

const AttentionMilestoneSchema = z.object({
  chip: z.string(),
  title: z.string(),
  section: z.string(),
  /** now: in progress or inside its window; slipped: its window ended with items open. */
  state: z.enum(['now', 'slipped']),
  window: z.object({ start: z.string(), end: z.string() }).nullable(),
  done: z.number(),
  total: z.number(),
  /** Plain text of the items marked in progress. */
  inProgress: z.array(z.string()),
  /** Tasks its text names, open or closed. */
  tasks: z.array(AttentionTaskSchema),
  /** No open task names it, so nothing on the board moves it forward. */
  gap: z.boolean(),
  /** HOME-relative page it came from. */
  source: z.string()
});

const Tasks = z.array(AttentionTaskSchema);

/** What an attention page shows, embedded in it as its `attention-data` block and returned by attention_write. */
export const AttentionDataSchema = z.object({
  schema: z.literal(1),
  operator: z.string(),
  /** Project slug of a project page; '' for the home page. */
  project: z.string(),
  /** The operator on the home page, the project's title on a project page. */
  scopeLabel: z.string(),
  today: z.string(),
  week: z.string(),
  generatedAt: z.string(),
  lanes: z.object({ carried: Tasks, today: Tasks, week: Tasks, month: Tasks, later: Tasks }),
  /** Done tasks planned for a current period, shown struck through. */
  done: z.object({ today: Tasks, week: Tasks, month: Tasks }),
  /** Everything planned inside this week and this month, whatever lane it sits in now: the progress count. */
  planned: z.object({ week: z.object({ open: Tasks, done: Tasks }), month: z.object({ open: Tasks, done: Tasks }) }),
  // Pages written before the day horizon existed carry none.
  dayGoals: z.array(z.string()).default([]),
  weekGoals: z.array(z.string()),
  monthGoals: z.array(z.string()),
  /** Open tasks of mine with no horizon yet. */
  unplanned: Tasks,
  /** Open tasks due today or earlier that no current period plans (no horizon, or later). */
  dueUnplanned: Tasks,
  /** Roadmap milestones in flight, slipped first, plus a line for each roadmap this page couldn't use fully. */
  roadmap: z.object({ milestones: z.array(AttentionMilestoneSchema), notices: z.array(z.string()) }),
  /** A project page's pins, HOME-relative; pages written before project pins carry none. */
  pins: z.array(z.object({ title: z.string(), icon: z.string(), path: z.string() })).default([]),
  snapshot: AttentionSnapshotSchema.nullable()
});

export type AttentionTask = z.infer<typeof AttentionTaskSchema>;
export type AttentionMilestone = z.infer<typeof AttentionMilestoneSchema>;
export type AttentionData = z.infer<typeof AttentionDataSchema>;

export interface AttentionView extends AttentionData {
  home: string;
  markdownUrl: string;
  projectHues: Readonly<Record<string, number>>;
  /** When the queue was pulled, in the operator's time; `day` (`Mon 28`) is '' when it was today. Null with no pull. */
  queuePulled: { day: string; time: string } | null;
}

/** The page's data, with what only the renderer needs stripped. */
export const attentionData = (view: AttentionView): AttentionData => AttentionDataSchema.parse(view);

/** null when the page carries no attention data, or data from another schema. */
export const readAttentionData = (html: string): AttentionData | null => {
  const block = readJsonBlock(html, 'attention-data');
  const parsed = block?.kind === 'data' ? AttentionDataSchema.safeParse(block.data) : null;
  return parsed?.success ? parsed.data : null;
};

/** A `YYYY-MM-DD` date in words, read as a calendar day so no time zone shifts it. */
export const formatDate = (date: string, options: Intl.DateTimeFormatOptions): string =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { ...options, timeZone: 'UTC' });

/** Where a task was planned, short: `Fri 25`, `W39`, `Aug`. */
export const horizonLabel = (horizon: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(horizon)) {
    return formatDate(horizon, { weekday: 'short', day: 'numeric' });
  }
  if (/^\d{4}-W\d{2}$/.test(horizon)) {
    return horizon.slice(5);
  }
  return /^\d{4}-\d{2}$/.test(horizon) ? formatDate(`${horizon}-01`, { month: 'short' }) : horizon;
};

/** Where a task stands in the plan, in words: `today`, `week`, `carried over`, `not planned`, or its closed status. */
export const taskStanding = (task: AttentionTask, today: string): string => {
  if (task.status === 'done' || task.status === 'cancelled') {
    return task.status;
  }
  const bucket = horizonBucket(task.horizon, today);
  return bucket === 'carried' ? 'carried over' : (bucket ?? 'not planned');
};
