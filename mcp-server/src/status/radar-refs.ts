/**
 * Pure helpers for the radar Recent-tab "related tasks + plans" feature.
 *
 * The Recent tab links each session card to the tasks it worked on and the
 * plans it produced, derived from the session's transcript. A RAW transcript
 * scan is useless: CLAUDE.md @-imports TASKS.md + the memory index into every
 * session, so every transcript carries the same context IDs. We scan only the
 * actual conversation — real user text, assistant text, and assistant tool_use
 * inputs (file paths, task-tool args) — never the injected context or tool
 * *results*. (Mirrors list_sessions.ts's isRealUserText.)
 *
 * Config-free by design (no @/config import) so it's unit-testable without
 * freezing KEVIN_HOME for the test process — collect.ts owns the disk I/O.
 */
import { resolve } from 'node:path';

export interface RadarTaskRef {
  title: string;
  filePath: string;
}

export interface SessionRefs {
  /** Task IDs ordered by mention frequency (desc), then id. */
  taskIds: string[];
  /** `reports/plans/<slug>.md` hrefs, in first-seen order. */
  planHrefs: string[];
}

const TASK_ID_RE = /\b[a-z]{2}-\d{3}\b/g;
const PLAN_HREF_RE = /reports\/plans\/[^"'\s)]+\.md/g;
const RADAR_TASK_CAP = 8;

/** A jsonl transcript line, narrowed to the fields we read. */
interface TranscriptRecord {
  type?: string;
  message?: { content?: string | { type?: string; text?: string; input?: unknown }[] };
}

/** True for genuine human prose — excludes system-reminders (`<…`), the skill
 *  payload header, and interrupt markers. */
export const isConversationUserText = (text: string): boolean => {
  const trimmed = text.trim();
  return (
    trimmed.length > 0 &&
    !trimmed.startsWith('<') &&
    !trimmed.startsWith('Base directory for this skill:') &&
    !trimmed.startsWith('[Request interrupted')
  );
};

/** Conversation-only text of a transcript (user prose + assistant text +
 *  assistant tool_use inputs); excludes injected context and tool results. */
export const conversationTextFromLines = (lines: readonly string[]): string =>
  lines
    .flatMap((line) => {
      let record: TranscriptRecord;
      try {
        record = JSON.parse(line) as TranscriptRecord;
      } catch {
        return [];
      }
      const content = record.message?.content;
      if (record.type === 'user') {
        return typeof content === 'string' && isConversationUserText(content) ? [content] : [];
      }
      if (record.type === 'assistant' && Array.isArray(content)) {
        return content.flatMap((block) =>
          block.type === 'text' && typeof block.text === 'string'
            ? [block.text]
            : block.type === 'tool_use'
              ? [JSON.stringify(block.input ?? '')]
              : []
        );
      }
      return [];
    })
    .join('\n');

/** Task IDs (filtered to real task files, frequency-ordered) and plan hrefs a
 *  session worked on, from its conversation text. */
export const extractSessionRefs = (text: string, taskIndex: Map<string, RadarTaskRef>): SessionRefs => {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(TASK_ID_RE)) {
    if (taskIndex.has(match[0])) {
      counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
    }
  }
  const taskIds = [...counts.entries()]
    .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]))
    .map(([id]) => id);
  const planHrefs = [...new Set(text.match(PLAN_HREF_RE) ?? [])];
  return { taskIds, planHrefs };
};

/** Minimal HTML-entity escape for text/attribute values spliced as raw HTML. */
export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** `<a href="opener-url">label</a>` for an absolute path. */
export const openerAnchor = (label: string, absPath: string, markdownUrl: string): string =>
  `<a href="${escapeHtml(markdownUrl.replace('{path}', encodeURIComponent(absPath)))}">${escapeHtml(label)}</a>`;

const metaRow = (tag: string, inner: string): string =>
  `<div class="rmeta-row"><span class="rmeta-tag">${tag}</span> ${inner}</div>`;

/** The session's tasks + plans as raw HTML `.rmeta-row` divs — one item per row
 *  (🔗 per task, 📋 per plan) — to nest inside a `.radar-meta` box alongside the
 *  resume. Empty string when there are none. */
export const composeMetaRows = (
  refs: SessionRefs,
  taskIndex: Map<string, RadarTaskRef>,
  planTitles: Map<string, string>,
  markdownUrl: string,
  home: string
): string => {
  const taskRows = refs.taskIds.slice(0, RADAR_TASK_CAP).map((id) => {
    const task = taskIndex.get(id);
    return metaRow(
      '🔗',
      task ? `${openerAnchor(id, task.filePath, markdownUrl)} ${escapeHtml(task.title)}` : escapeHtml(id)
    );
  });
  const overflow =
    refs.taskIds.length > RADAR_TASK_CAP ? [metaRow('🔗', `+${refs.taskIds.length - RADAR_TASK_CAP} more`)] : [];
  const planRows = refs.planHrefs.map((href) => {
    const title = planTitles.get(href) ?? href.replace(/^reports\/plans\//, '').replace(/\.md$/, '');
    return metaRow('📋', openerAnchor(title, resolve(home, href), markdownUrl));
  });
  return [...taskRows, ...overflow, ...planRows].join('');
};

/** The `.radar-meta` box: the tasks/plans rows (may be empty) plus the resume
 *  command, grouped in one subsection. Shared by both dashboard feeds. */
export const composeMetaBox = (metaRows: string, resumeCommand: string): string =>
  `<div class="radar-meta">${metaRows}<div class="rmeta-row resume">↳ <code>${escapeHtml(resumeCommand)}</code></div></div>`;
