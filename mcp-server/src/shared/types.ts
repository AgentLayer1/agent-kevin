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

/**
 * One entry in state.ingested — tracks a compiled file.
 *
 * `hash` is of the whole file (legacy gating). `bytes` is the incremental
 * compile cursor: the byte offset compiled up to, with `prefix_hash` covering
 * `[0, bytes)` so a non-append edit (rather than a pure append) is detected
 * and triggers a from-scratch recompile. Entries written before incremental
 * compile landed have no `bytes`/`prefix_hash` and fall back to whole-file
 * hash gating — past day-files never change, so they stay skipped.
 */
export interface IngestedEntry {
  hash: string;
  compiled_at: string;
  cost_usd: number;
  bytes?: number;
  prefix_hash?: string;
}

/** One session's slice of a day-file: turns `[from, to]` captured on `date`. */
export interface SessionBlock {
  date: string;
  from: number;
  to: number;
}

/**
 * One session in the raw-session catalog (`raw/sessions/index.json`). Keyed by
 * sessionId. `captured_turns` is the capture cursor (high-water mark of turns
 * written to raw); `last_turn_fp` fingerprints that turn so a rewritten
 * transcript is detected. Reconstructable from day-file block headers.
 */
export interface SessionRecord {
  first_seen: string;
  last_seen: string;
  cwd: string;
  captured_turns: number;
  last_turn_fp: string;
  briefing: string;
  blocks: SessionBlock[];
}

export interface SessionIndex {
  schema: number;
  sessions: Record<string, SessionRecord>;
}

/**
 * One entry in state.partial — tracks how far through a multi-chunk *slice* we
 * got. The slice `[slice_start, slice_end)` is pinned at first pick so an
 * append to the file mid-compile can't shift the chunk count. `hash` covers the
 * pinned slice, so an unexpected rewrite of that region invalidates progress.
 * On full success the entry is deleted and the file's `ingested` cursor
 * advances to `slice_end`.
 */
export interface PartialEntry {
  hash: string;
  slice_start: number;
  slice_end: number;
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
