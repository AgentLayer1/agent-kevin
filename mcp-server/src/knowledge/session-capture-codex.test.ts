import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { HOME_MARKER_FILES, RUNTIME_DIR_DEFAULT } from '@/shared/naming';

/**
 * The Codex rollout extractor, fed the record shapes Codex 0.153 actually writes
 * (session_meta, response_item messages by role, tool calls, event_msg noise), in
 * its own home so its capture cursor never collides with the pipeline suite.
 */
const HOME = mkdtempSync(resolve(tmpdir(), 'capture-codex-'));
const PRELOAD_HOME = process.env.AGENT_HOME;
process.env.AGENT_HOME = HOME;
const SESSIONS = resolve(HOME, 'knowledge', 'raw', 'sessions');
const rollout = resolve(HOME, 'rollout-2026-09-07T01-43-38-01a077d1-91e1-7cc1-a3a8-ced457819b33.jsonl');

let captureSession: typeof import('@/knowledge/session-capture').captureSession;

const item = (payload: Record<string, unknown>) =>
  JSON.stringify({ timestamp: '2026-09-06T17:44:08.852Z', type: 'response_item', payload });
const message = (role: string, text: string) =>
  item({
    type: 'message',
    id: 'msg_x',
    role,
    content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }]
  });

beforeAll(async () => {
  mkdirSync(SESSIONS, { recursive: true });
  mkdirSync(resolve(HOME, RUNTIME_DIR_DEFAULT), { recursive: true });
  writeFileSync(resolve(HOME, RUNTIME_DIR_DEFAULT, HOME_MARKER_FILES[0]), '{}\n');
  writeFileSync(
    rollout,
    [
      JSON.stringify({
        type: 'session_meta',
        payload: { id: '01a077d1-91e1-7cc1-a3a8-ced457819b33', cwd: HOME, cli_version: '0.153.4' }
      }),
      message(
        'user',
        '# AGENTS.md instructions for /Users/x/Test\n\n<INSTRUCTIONS>\n# AGENTS.md — Scout\n</INSTRUCTIONS>'
      ),
      message('user', '<environment_context>\n  <cwd>/Users/x/Test</cwd>\n</environment_context>'),
      message('developer', '<skills_instructions>\n## Skills\n</skills_instructions>'),
      message('developer', 'KEVIN-STACK-BEGIN\n...\nKEVIN-STACK-END'),
      JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } }),
      JSON.stringify({ type: 'turn_context', payload: { turn_id: 't1', model: 'gpt-6-astra' } }),
      message('user', "Who are you and what's active right now?"),
      item({ type: 'reasoning', summary: [] }),
      message('assistant', "I'm Scout, your personal AI assistant, running in Codex here."),
      message('user', '$quick-pulse'),
      message(
        'user',
        '<skill>\n<name>quick-pulse</name>\n<path>/Users/x/Test/.agents/skills/quick-pulse/SKILL.md</path>\n---\nname: quick-pulse\n</skill>'
      ),
      item({ type: 'custom_tool_call', name: 'exec', input: 'text(await tools.mcp__kevin__task_scan({}))' }),
      item({
        type: 'custom_tool_call_output',
        call_id: 'c1',
        output: [{ type: 'input_text', text: 'Script completed' }]
      }),
      message('assistant', '🩺 **Pulse: ⚠️ Needs attention**\n\n10 active tasks.'),
      'not json at all',
      message('user', 'exit')
    ].join('\n') + '\n',
    'utf-8'
  );
  ({ captureSession } = await import('@/knowledge/session-capture'));
});

afterAll(() => {
  process.env.AGENT_HOME = PRELOAD_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

describe('codex rollout capture', () => {
  test('keeps only what the operator and the model said, in order', async () => {
    const result = await captureSession({
      transcriptPath: rollout,
      cwd: HOME,
      sessionId: '01a077d1-91e1-7cc1-a3a8-ced457819b33',
      mode: 'session-end',
      format: 'codex'
    });
    expect(result.saved).toBe(true);
    if (!result.saved) return;
    expect(result.turns).toBe(5);
    const dayFile = readdirSync(SESSIONS).find((name) => name.endsWith('.md')) ?? '';
    const day = readFileSync(resolve(SESSIONS, dayFile), 'utf-8');
    expect(day).toContain('[01a077d1]');
    expect(day).toContain('· turns 1–5 · codex: gpt-6-astra');
    expect(day).toContain("Who are you and what's active right now?");
    expect(day).toContain("I'm Scout, your personal AI assistant");
    expect(day).toContain('$quick-pulse');
    expect(day).toContain('Needs attention');
    expect(day).toContain('exit');
    for (const injected of [
      '# AGENTS.md instructions',
      '<environment_context>',
      '<skill>',
      '<skills_instructions>',
      'KEVIN-STACK-BEGIN',
      'tools.mcp__kevin__task_scan',
      'Script completed'
    ]) {
      expect(day).not.toContain(injected);
    }
  });

  test('a second capture of the same rollout is a no-op', async () => {
    const again = await captureSession({
      transcriptPath: rollout,
      cwd: HOME,
      sessionId: '01a077d1-91e1-7cc1-a3a8-ced457819b33',
      mode: 'session-end',
      format: 'codex'
    });
    expect(again.saved).toBe(false);
    if (!again.saved) expect(again.reason).toBe('no-new-turns');
  });
});
