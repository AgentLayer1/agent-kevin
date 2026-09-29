import { readJsonBlock } from '@/shared/json-block';
import { z } from 'zod';

export const FOCUS_TONES = ['good', 'warn', 'bad', 'dim'] as const;

export const FocusItemSchema = z.object({
  title: z.string(),
  url: z
    .string()
    .refine((url) => url === '' || /^https?:\/\//i.test(url), 'Queue links must be http(s)')
    .default(''),
  detail: z.string().default(''),
  tone: z.enum(FOCUS_TONES).default('dim')
});

export const FocusGroupSchema = z.object({
  label: z.string().min(1),
  empty: z.string().default('Nothing here.'),
  items: z.array(FocusItemSchema).default([]),
  /** Why part or all of this source couldn't be read; shown once, never counted as an item. */
  unavailable: z.string().default('')
});

export const FocusSnapshotSchema = z.object({
  fetchedAt: z.string(),
  groups: z.array(FocusGroupSchema).default([])
});

export type FocusItem = z.infer<typeof FocusItemSchema>;
export type FocusGroup = z.infer<typeof FocusGroupSchema>;
export type FocusSnapshot = z.infer<typeof FocusSnapshotSchema>;

const FocusTaskSchema = z.object({
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

const FocusMilestoneSchema = z.object({
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
  tasks: z.array(FocusTaskSchema),
  /** No open task names it, so nothing on the board moves it forward. */
  gap: z.boolean(),
  /** HOME-relative page it came from. */
  source: z.string()
});

const Tasks = z.array(FocusTaskSchema);

/** What a focus page shows, embedded in it as its `focus-data` block and returned by focus_write. */
export const FocusDataSchema = z.object({
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
  weekGoals: z.array(z.string()),
  monthGoals: z.array(z.string()),
  /** Open tasks of mine with no horizon yet. */
  unplanned: Tasks,
  /** Open tasks due today or earlier that no current period plans (no horizon, or later). */
  dueUnplanned: Tasks,
  /** Roadmap milestones in flight, slipped first, plus a line for each roadmap this page couldn't use fully. */
  roadmap: z.object({ milestones: z.array(FocusMilestoneSchema), notices: z.array(z.string()) }),
  snapshot: FocusSnapshotSchema.nullable()
});

export type FocusTask = z.infer<typeof FocusTaskSchema>;
export type FocusMilestone = z.infer<typeof FocusMilestoneSchema>;
export type FocusData = z.infer<typeof FocusDataSchema>;

export interface FocusView extends FocusData {
  home: string;
  markdownUrl: string;
  /** When the queue was pulled, in the operator's time: `09:47`, or `Mon 28 · 09:47` on another day; '' with no pull. */
  queuePulled: string;
}

/** The page's data, with what only the renderer needs stripped. */
export const focusData = (view: FocusView): FocusData => FocusDataSchema.parse(view);

/** null when the page carries no focus data, or data from another schema. */
export const readFocusData = (html: string): FocusData | null => {
  const block = readJsonBlock(html, 'focus-data');
  const parsed = block?.kind === 'data' ? FocusDataSchema.safeParse(block.data) : null;
  return parsed?.success ? parsed.data : null;
};
