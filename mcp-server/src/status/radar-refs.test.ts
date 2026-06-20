import { describe, expect, test } from 'bun:test';
import {
  composeMetaBox,
  composeMetaRows,
  conversationTextFromLines,
  extractSessionRefs,
  isConversationUserText,
  openerAnchor,
  type RadarTaskRef
} from './radar-refs';

const taskIndex = new Map<string, RadarTaskRef>([
  ['lo-002', { title: 'MCP integrations', filePath: '/home/projects/life-os/tasks/lo-002-mcp.md' }],
  ['al-005', { title: 'Apply for MD Status', filePath: '/home/projects/agent-layer/tasks/al-005-apply.md' }]
]);

const userLine = (text: string) => JSON.stringify({ type: 'user', message: { content: text } });
const assistantText = (text: string) =>
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const assistantToolUse = (input: unknown) =>
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', input }] } });
const toolResult = (text: string) =>
  JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: text }] } });

describe('isConversationUserText', () => {
  test('rejects system-reminders, skill payloads, and interrupts', () => {
    expect(isConversationUserText('<system-reminder>al-005</system-reminder>')).toBe(false);
    expect(isConversationUserText('Base directory for this skill: /x')).toBe(false);
    expect(isConversationUserText('[Request interrupted by user]')).toBe(false);
    expect(isConversationUserText('   ')).toBe(false);
    expect(isConversationUserText('please work on al-005')).toBe(true);
  });
});

describe('conversationTextFromLines', () => {
  test('keeps user prose, assistant text, and tool_use inputs; drops context + tool results', () => {
    const lines = [
      userLine('let us tackle lo-002 today'),
      userLine('<system-reminder>al-005 zb-001 huge context dump</system-reminder>'),
      assistantText('I will start on lo-002'),
      assistantToolUse({ file_path: '/home/projects/life-os/tasks/lo-002-mcp.md' }),
      toolResult('al-005 zb-001 al-014 — task board dumped by a tool result'),
      'not json at all'
    ];
    const text = conversationTextFromLines(lines);
    expect(text).toContain('lo-002');
    expect(text).toContain('I will start on lo-002');
    expect(text).toContain('lo-002-mcp.md');
    // Context dump (system-reminder) and tool-result board are excluded.
    expect(text).not.toContain('zb-001');
    expect(text).not.toContain('huge context dump');
    expect(text).not.toContain('task board dumped');
  });
});

describe('extractSessionRefs', () => {
  test('keeps only indexed IDs, orders by frequency then id', () => {
    const text = 'al-005 lo-002 lo-002 lo-002 al-005 en-033 zz-999';
    const refs = extractSessionRefs(text, taskIndex);
    // lo-002 (×3) before al-005 (×2); en-033/zz-999 not in the index → dropped.
    expect(refs.taskIds).toEqual(['lo-002', 'al-005']);
  });

  test('collects deduped plan hrefs', () => {
    const text = 'wrote reports/plans/foo-bar.md then edited reports/plans/foo-bar.md and reports/plans/baz.md';
    const refs = extractSessionRefs(text, taskIndex);
    expect(refs.planHrefs).toEqual(['reports/plans/foo-bar.md', 'reports/plans/baz.md']);
  });

  test('empty text yields empty refs', () => {
    expect(extractSessionRefs('', taskIndex)).toEqual({ taskIds: [], planHrefs: [] });
  });
});

describe('openerAnchor', () => {
  test('builds an anchor through the opener template, escaping href & label', () => {
    expect(openerAnchor('al-005', '/a b/c.md', 'obsidian://open?path={path}&paneType=tab')).toBe(
      '<a href="obsidian://open?path=%2Fa%20b%2Fc.md&amp;paneType=tab">al-005</a>'
    );
    expect(openerAnchor('plan <v2>', '/x.md', 'x://{path}')).toContain('>plan &lt;v2&gt;</a>');
  });
});

describe('composeMetaRows', () => {
  const url = 'obsidian://open?path={path}&paneType=tab';
  const planTitles = new Map<string, string>([['reports/plans/foo-bar.md', 'My Plan Title']]);

  test('emits one row per task and per plan as HTML divs', () => {
    const rows = composeMetaRows(
      { taskIds: ['lo-002', 'al-005'], planHrefs: ['reports/plans/foo-bar.md'] },
      taskIndex,
      planTitles,
      url,
      '/home'
    );
    expect(rows).toContain('<div class="rmeta-row"><span class="rmeta-tag">🔗</span> <a href="obsidian://open?path=');
    expect(rows).toContain('>lo-002</a> MCP integrations');
    expect(rows).toContain('>al-005</a> Apply for MD Status');
    expect(rows).toContain('<span class="rmeta-tag">📋</span> <a href="obsidian://open?path=');
    expect(rows).toContain('>My Plan Title</a>');
    expect(rows).toContain(encodeURIComponent('/home/reports/plans/foo-bar.md'));
    // One row per item: 2 tasks + 1 plan = 3 rows, none comma/·-joined.
    expect(rows.match(/<div class="rmeta-row">/g)).toHaveLength(3);
    expect(rows).not.toContain(' · ');
  });

  test('falls back to the plan slug when the title is unknown', () => {
    const rows = composeMetaRows(
      { taskIds: [], planHrefs: ['reports/plans/baz.md'] },
      taskIndex,
      planTitles,
      url,
      '/home'
    );
    expect(rows).toContain('>baz</a>');
  });

  test('caps tasks at 8 with an overflow marker', () => {
    const ids = Array.from({ length: 11 }, (_unused, index) => `lo-${String(index).padStart(3, '0')}`);
    const bigIndex = new Map<string, RadarTaskRef>(
      ids.map((id) => [id, { title: `Task ${id}`, filePath: `/home/${id}.md` }])
    );
    const rows = composeMetaRows({ taskIds: ids, planHrefs: [] }, bigIndex, planTitles, url, '/home');
    expect(rows).toContain('+3 more');
    expect(rows).not.toContain(`>${ids[8]}</a>`);
    // 8 task rows + 1 overflow row.
    expect(rows.match(/<div class="rmeta-row">/g)).toHaveLength(9);
  });

  test('returns empty string when nothing to show', () => {
    expect(composeMetaRows({ taskIds: [], planHrefs: [] }, taskIndex, planTitles, url, '/home')).toBe('');
  });
});

describe('composeMetaBox', () => {
  test('wraps meta rows + a resume row in a .radar-meta box', () => {
    const box = composeMetaBox('<div class="rmeta-row">x</div>', 'claude --resume abc-123');
    expect(box).toBe(
      '<div class="radar-meta"><div class="rmeta-row">x</div><div class="rmeta-row resume">↳ <code>claude --resume abc-123</code></div></div>'
    );
  });

  test('renders a resume-only box when there are no meta rows', () => {
    const box = composeMetaBox('', 'claude --resume abc-123');
    expect(box).toBe(
      '<div class="radar-meta"><div class="rmeta-row resume">↳ <code>claude --resume abc-123</code></div></div>'
    );
  });
});
