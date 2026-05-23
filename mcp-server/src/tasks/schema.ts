import type {
  ChecklistItem,
  ParsedFrontmatter,
  TaskFile,
  TaskFrontmatter,
  TaskPriority,
  TaskStatus,
  TaskType,
  ThreadEntry
} from '@/shared/types';
import { todayDate } from '@/shared/date';
import { readFileSync } from 'fs';

// ── Valid Status Transitions ──────────────────────────────────────────

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  open: ['active', 'blocked', 'cancelled'],
  active: ['blocked', 'done', 'cancelled'],
  blocked: ['active'],
  done: ['active'],
  cancelled: []
};

export const isValidTransition = (from: TaskStatus, to: TaskStatus): boolean =>
  VALID_TRANSITIONS[from]?.includes(to) ?? false;

// ── Defaults ──────────────────────────────────────────────────────────

export const defaultFrontmatter = (project: string, title: string, assignee: string[]): TaskFrontmatter => ({
  schema: 1,
  id: '', // assigned by mutate.ts
  title,
  type: 'task',
  status: 'open',
  priority: 'P2',
  project,
  assignee,
  labels: [],
  created: todayDate(),
  updated: todayDate(),
  due: '',
  depends_on: [],
  blocked_by: '',
  parent: '',
  closed: ''
});

// ── Parsing ───────────────────────────────────────────────────────────

// Tolerates both LF and CRLF line endings. All internal work normalizes to LF.
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * Split a YAML inline array body (between [ and ]) into items,
 * respecting single- and double-quoted strings so quoted commas don't split items.
 */
const splitInlineArray = (inner: string): string[] => {
  const items: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = null;
      else buf += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ',') {
      items.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim() !== '') items.push(buf.trim());
  return items;
};

const parseYamlValue = (raw: string): string | string[] => {
  const trimmed = raw.trim();
  // Array: [a, b, c]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1);
    if (inner.trim() === '') return [];
    return splitInlineArray(inner);
  }
  // Quoted string
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const parseFrontmatterFull = (raw: string): ParsedFrontmatter | null => {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return null;

  const fields: Record<string, string | string[]> = {};
  // Track lines that belong to unknown keys — preserved verbatim on re-emit.
  const extraLines: string[] = [];
  let extraActive = false;
  let lastKey = '';

  const knownKeys = new Set<string>(FRONTMATTER_FIELDS);

  for (const rawLine of match[1].split('\n')) {
    const line = rawLine.replace(/\r$/, '');

    // Multi-line array item: optional indent, then "- value"
    const dashMatch = line.match(/^\s*-\s+(.+)/);
    if (dashMatch && lastKey) {
      if (extraActive) {
        extraLines.push(line);
        continue;
      }
      const existing = fields[lastKey];
      if (Array.isArray(existing)) {
        existing.push(dashMatch[1].trim());
      } else {
        fields[lastKey] = [dashMatch[1].trim()];
      }
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      // Unknown-key continuation (e.g. YAML block scalars we don't model). Preserve.
      if (extraActive) extraLines.push(line);
      continue;
    }

    const key = line.slice(0, colonIdx).trim();
    if (!knownKeys.has(key)) {
      extraActive = true;
      extraLines.push(line);
      lastKey = key;
      continue;
    }

    extraActive = false;
    const value = line.slice(colonIdx + 1);
    fields[key] = parseYamlValue(value);
    lastKey = key;
  }

  const str = (key: string, fallback = ''): string => {
    const val = fields[key];
    return typeof val === 'string' ? val : fallback;
  };
  const arr = (key: string): string[] => {
    const val = fields[key];
    return Array.isArray(val) ? val : val ? [val] : [];
  };

  const frontmatter: TaskFrontmatter = {
    schema: parseInt(str('schema', '1'), 10) || 1,
    id: str('id'),
    title: str('title'),
    type: (str('type', 'task') as TaskType) || 'task',
    status: (str('status', 'open') as TaskStatus) || 'open',
    priority: (str('priority', 'P2') as TaskPriority) || 'P2',
    project: str('project'),
    assignee: arr('assignee'),
    labels: arr('labels'),
    created: str('created'),
    updated: str('updated'),
    due: str('due'),
    depends_on: arr('depends_on'),
    blocked_by: str('blocked_by'),
    parent: str('parent'),
    closed: str('closed')
  };

  return { frontmatter, extraLines };
};

export const parseFrontmatter = (raw: string): TaskFrontmatter | null => parseFrontmatterFull(raw)?.frontmatter ?? null;

const CHECKLIST_RE = /^- \[([ xX])\] (.+)$/;
const THREAD_RE = /^> \[!(quote|info|warning)\] ([\w-]+) · (\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/;

export const parseTaskFile = (filePath: string): TaskFile | null => {
  const content = readFileSync(filePath, 'utf-8');
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) return null;

  // Strip frontmatter for body parsing
  const body = content.replace(FRONTMATTER_RE, '').trim();

  // Parse sections — only known section headers are boundaries.
  // Anything else (## Objective, ### Details, etc.) stays in the current section.
  const KNOWN_SECTIONS = new Set(['description', 'checklist', 'thread']);
  const sections: Record<string, string> = {};
  let currentSection = '';
  for (const line of body.split('\n')) {
    if (line.startsWith('## ')) {
      const name = line.slice(3).trim().toLowerCase();
      if (KNOWN_SECTIONS.has(name)) {
        currentSection = name;
        sections[currentSection] = '';
        continue;
      }
    }
    if (currentSection) {
      sections[currentSection] += line + '\n';
    }
  }

  // Parse checklist
  const checklist: ChecklistItem[] = [];
  for (const line of (sections['checklist'] ?? '').split('\n')) {
    const match = line.match(CHECKLIST_RE);
    if (match) {
      checklist.push({ checked: match[1] !== ' ', text: match[2] });
    }
  }

  // Parse thread (callout blocks). A callout line is `> <content>` or bare `>`
  // (blank line inside the callout). An empty line ends the current entry.
  const thread: ThreadEntry[] = [];
  const threadLines = (sections['thread'] ?? '').split('\n');
  let current: ThreadEntry | null = null;

  for (const line of threadLines) {
    const headerMatch = line.match(THREAD_RE);
    if (headerMatch) {
      if (current) thread.push(current);
      current = {
        type: headerMatch[1] as ThreadEntry['type'],
        author: headerMatch[2],
        timestamp: headerMatch[3],
        message: ''
      };
    } else if (current && (line.startsWith('> ') || line === '>')) {
      const text = line === '>' ? '' : line.slice(2);
      current.message += (current.message ? '\n' : '') + text;
    } else if (current && line.trim() === '') {
      thread.push(current);
      current = null;
    }
  }
  if (current) thread.push(current);

  return { frontmatter, description: sections['description']?.trim() ?? '', checklist, thread, filePath };
};

// ── Serialization ─────────────────────────────────────────────────────

const NEEDS_QUOTING = /[:\[\]{}#&*!|>'"%@`,?]/;

export const serializeValue = (val: string | string[] | number): string => {
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]';
    const items = val.map((item) => (NEEDS_QUOTING.test(item) ? `"${item}"` : item));
    return `[${items.join(', ')}]`;
  }
  if (typeof val === 'number') return String(val);
  if (NEEDS_QUOTING.test(val)) return `"${val}"`;
  return val;
};

/** Emit a "key: value" line. Empty values get "key:" (no trailing space) to match
 *  how Obsidian's Properties panel writes empty fields. */
const emitField = (key: string, val: string | string[] | number): string => {
  const serialized = serializeValue(val);
  return serialized === '' ? `${key}:` : `${key}: ${serialized}`;
};

/** Ordered list of frontmatter fields — must match serializeTask field order. */
export const FRONTMATTER_FIELDS: (keyof TaskFrontmatter)[] = [
  'schema',
  'id',
  'title',
  'type',
  'status',
  'priority',
  'project',
  'assignee',
  'labels',
  'created',
  'updated',
  'due',
  'depends_on',
  'blocked_by',
  'parent',
  'closed'
];

/**
 * Replace ONLY the frontmatter block in raw file content.
 * Body (description, checklist, thread) is preserved byte-for-byte.
 * Unknown keys present in the original are preserved verbatim after known fields,
 * so third-party tools can add frontmatter fields without us dropping them.
 */
export const replaceFrontmatter = (content: string, fm: TaskFrontmatter): string => {
  const match = content.match(FRONTMATTER_RE);
  const parsed = match ? parseFrontmatterFull(content) : null;
  if (!match || !parsed) return content;

  const body = content.slice(match[0].length);
  const fmLines = ['---'];
  for (const key of FRONTMATTER_FIELDS) fmLines.push(emitField(key, fm[key]));
  for (const line of parsed.extraLines) fmLines.push(line);
  fmLines.push('---');

  return fmLines.join('\n') + body;
};

export const serializeTask = (task: TaskFile): string => {
  const fm = task.frontmatter;
  const lines: string[] = ['---'];

  for (const key of FRONTMATTER_FIELDS) lines.push(emitField(key, fm[key]));
  lines.push('---', '');

  // Description
  lines.push('## Description', '', task.description || '', '');

  // Checklist
  lines.push('## Checklist', '');
  for (const item of task.checklist) {
    lines.push(`- [${item.checked ? 'x' : ' '}] ${item.text}`);
  }
  lines.push('');

  // Thread
  lines.push('## Thread', '');
  for (const entry of task.thread) {
    lines.push(`> [!${entry.type}] ${entry.author} · ${entry.timestamp}`);
    for (const msgLine of entry.message.split('\n')) {
      lines.push(`> ${msgLine}`);
    }
    lines.push('');
  }

  return lines.join('\n');
};
