import type { z } from 'zod';

// ── Knowledge types ───────────────────────────────────────────────────

/** A single text-bearing turn from a Claude Code transcript. */
export interface TranscriptTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** Kinds of feedback written to raw/user/feedback.md. */
export type FeedbackKind = 'reaction+' | 'reaction-' | 'correction';

/** Output of the correction detector — one hit per triggered user turn. */
export interface CorrectionHit {
  userText: string;
  assistantContext: string;
  matched: string;
}

/** One entry in state.ingested — tracks a compiled file by hash. */
export interface IngestedEntry {
  hash: string;
  compiled_at: string;
  cost_usd: number;
}

/**
 * One entry in state.partial — tracks how far through a multi-chunk file we
 * got. Hash is recorded so a content change between runs invalidates the
 * partial progress (chunks would no longer align). On full success the entry
 * is deleted and the file is promoted into `ingested`.
 */
export interface PartialEntry {
  hash: string;
  completed: number;
  total: number;
  cost_usd: number;
}

/** Shape of knowledge module state file. Persisted between compile runs. */
export interface CompileState {
  ingested: Record<string, IngestedEntry>;
  in_flight: string | null;
  partial: Record<string, PartialEntry>;
  query_count: number;
  last_lint: string | null;
}

// ── Task types ───────────────────────────────────────────────────────

export type TaskStatus = 'open' | 'active' | 'blocked' | 'done' | 'cancelled';
export type TaskPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type TaskType = 'task' | 'bug' | 'idea' | 'epic';

export interface TaskFrontmatter {
  schema: number;
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  project: string;
  assignee: string[];
  labels: string[];
  created: string;
  updated: string;
  due: string;
  depends_on: string[];
  blocked_by: string;
  parent: string;
  closed: string;
}

export interface ChecklistItem {
  checked: boolean;
  text: string;
}

export interface ThreadEntry {
  type: 'quote' | 'info' | 'warning';
  author: string;
  timestamp: string;
  message: string;
}

export interface TaskFile {
  frontmatter: TaskFrontmatter;
  description: string;
  checklist: ChecklistItem[];
  thread: ThreadEntry[];
  filePath: string;
}

export interface ParsedFrontmatter {
  frontmatter: TaskFrontmatter;
  extraLines: string[];
}

export interface CreateTaskOptions {
  project: string;
  title: string;
  description: string;
  assignee: string[];
  priority?: TaskPriority;
  type?: TaskType;
  labels?: string[];
  due?: string;
  depends_on?: string[];
  blocked_by?: string;
  parent?: string;
  checklist?: string[];
}

/**
 * Thrown when a task mutation writes to disk but the re-read shows a different
 * value than requested. Indicates serialization round-trip drift, partial write,
 * or sandbox rejection — never silently treated as success.
 */
export class PostWriteDriftError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly field: string,
    public readonly expected: unknown,
    public readonly actual: unknown,
    public readonly path: string
  ) {
    super(
      `Post-write drift on ${taskId}: requested ${field}=${JSON.stringify(expected)}, file shows ${JSON.stringify(actual)}. Write did not persist.`
    );
    this.name = 'PostWriteDriftError';
  }
}

// ── MCP tool definition ─────────────────────────────────────────────

/**
 * MCP tool definition. `inputSchema` is a Zod raw shape (object of zod types,
 * NOT a wrapped `z.object`). The SDK converts it to JSON Schema for clients
 * automatically. Handler args are inferred from the shape.
 */
export interface ToolDef<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  inputSchema: Shape;
  handler: (args: z.infer<z.ZodObject<Shape>>) => Promise<unknown>;
}

/** Helper to declare a typed tool while preserving the shape's inference. */
export const defineTool = <Shape extends z.ZodRawShape>(def: ToolDef<Shape>): ToolDef => def as unknown as ToolDef;
