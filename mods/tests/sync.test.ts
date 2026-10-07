import { describe, expect, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';

import { BAND_PROPS, QUESTION_MS, fakeHost, machine } from './fake-host';

const MCP = 'mcp__plugin_agent-kevin_kevin__';
const SURFACES = ['terminal', 'desktop'] as const;

const startSync = ($: Engine) => $.skill.prompt({ skill: 'agent-kevin:sync', text: 'SYNC PROTOCOL' });

const stats = async ($: Engine) => {
  const answer = await $.tool.call({ tool: 'mcp__agent-kevin__sync_stats' });
  return answer.result as {
    phase: string | null;
    actions: Record<string, number>;
    compileBacklog: { before: number | null; after: number | null };
    tasks: { before: { overdue: number } | null; after: { overdue: number } | null };
    brain: { before: { staleTasks: number } | null; after: { staleTasks: number } | null };
    phaseTimings: { phase: string; ms: number }[];
  };
};

describe('sync tracking', () => {
  test("sync's prompt gains the counted-numbers instruction; other skills are untouched", async ($, on) => {
    fakeHost(on);
    expect((await startSync($)).text).toContain('call `mcp__agent-kevin__sync_stats` once');
    expect((await $.skill.prompt({ skill: 'agent-kevin:focus', text: 'FOCUS' })).text).toBe('FOCUS');
  });

  test('phases move forward with the calls, never back, and actions are tallied from results', async ($, on) => {
    const host = fakeHost(on);
    host.toolText[`${MCP}knowledge_lint`] = JSON.stringify({ errors: 1, fixed: 4 });
    await startSync($);
    await $.tool.call({ tool: `${MCP}compile_write`, itemId: 'session:a' });
    await $.tool.call({ tool: `${MCP}compile_write`, itemId: 'session:b' });
    await host.clock.advance(60_000);
    await $.tool.call({ tool: `${MCP}knowledge_lint`, fix: true });
    await $.tool.call({ tool: `${MCP}task_close`, id: 'ac-001' });
    await $.tool.call({ tool: 'Bash', command: 'bun "/p/skills/sync/scripts/cadence.ts"' });
    await $.tool.call({ tool: `${MCP}task_update`, id: 'ac-002', status: 'blocked' });
    const numbers = await stats($);
    expect(numbers.phase).toBe('attention');
    expect(numbers.actions).toMatchObject({
      compiled: 2,
      lintFixed: 4,
      lintErrors: 1,
      tasksClosed: 1,
      tasksUpdated: 1
    });
    expect(numbers.phaseTimings.map((timing) => timing.phase)).toEqual(['compile', 'lint', 'flywheel']);
    expect(numbers.phaseTimings[0]?.ms).toBe(60_000);
  });

  test('the stats tool measures before at the start and after at the call', async ($, on) => {
    const host = fakeHost(on);
    await startSync($);
    host.compilePending = { sessions: 0, feedback: 0, inbox: 0 };
    host.taskScan = { overdue: 3, stale: 5, dueSoon: 2 };
    host.brainStale = 5;
    const numbers = await stats($);
    expect(numbers.compileBacklog).toEqual({ before: 4, after: 0 });
    expect(numbers.tasks.before?.overdue).toBe(7);
    expect(numbers.tasks.after?.overdue).toBe(3);
    expect(numbers.brain.before?.staleTasks).toBe(12);
    expect(numbers.brain.after?.staleTasks).toBe(5);
  });

  test('calls outside a sync are not tracked', async ($, on) => {
    fakeHost(on);
    await $.tool.call({ tool: `${MCP}compile_write`, itemId: 'x' });
    const answer = await $.tool.call({ tool: 'mcp__agent-kevin__sync_stats' });
    expect(answer.result).toEqual({ error: 'No sync is running in this session.' });
  });

  test('the end of the turn finishes the run and keeps it in the history', async ($, on) => {
    const host = fakeHost(on, machine());
    await startSync($);
    await host.clock.advance(90_000);
    await $.turn.complete({ answer: '', durationMs: 90_000, isAborted: false, turnId: 't1', reason: 'answer' });
    const stored = host.store.get('sync-history');
    expect(Array.isArray(stored) && stored).toHaveLength(1);
    expect(Array.isArray(stored) ? stored[0]?.totalMs : undefined).toBe(90_000);
  });
});

const bandText = async ($: Engine, surface: (typeof SURFACES)[number]) => {
  const band = await $.ui.mount({ plugin: 'agent-kevin', surface, component: 'AbovePrompt', props: BAND_PROPS });
  return (await band.findAll({ type: 'Text' })).map((element) => element.text).join('');
};

describe('sync band', () => {
  for (const surface of SURFACES) {
    test(`shows status, the step rail and counters that move during the run on ${surface}`, async ($, on) => {
      const host = fakeHost(on);
      await startSync($);
      host.compilePending = { sessions: 2, feedback: 1, inbox: 0 };
      await $.tool.call({ tool: `${MCP}compile_write`, itemId: 'session:a' });
      await host.clock.advance(125_000);
      const text = await bandText($, surface);
      expect(text).toContain('⟳ sync · running · 2m05s');
      expect(text).toContain('●─◉─○');
      expect(text).toContain('compile 2/12');
      expect(text).toContain('sessions 1/3');
      expect(text).toContain('feedback 0/1');
      expect(text).not.toContain('inbox');
      expect(text).toContain('stale 0/12');
      expect(text).toContain('1 compiled');
    });

    test(`shows waiting on you while sync asks a question on ${surface}`, async ($, on) => {
      const host = fakeHost(on);
      await startSync($);
      const question = $.tool.call({ tool: 'AskUserQuestion', questions: [] });
      await host.clock.settle();
      expect(await bandText($, surface)).toContain('⏸ sync · waiting on you');
      await host.clock.advance(QUESTION_MS);
      await question;
      expect(await bandText($, surface)).toContain('⟳ sync · running');
    });

    test(`shows one done line with the full rail and what was cleared on ${surface}`, async ($, on) => {
      const host = fakeHost(on);
      await startSync($);
      host.brainStale = 5;
      host.taskScan = { overdue: 9, stale: 12, dueSoon: 2 };
      await host.clock.advance(60_000);
      await $.turn.complete({ answer: '', durationMs: 60_000, isAborted: false, turnId: 't1', reason: 'answer' });
      const text = await bandText($, surface);
      expect(text).toContain('✓ sync · done · 1m00s');
      expect(text).toContain('●─●─●─●─●─●─●─●─●─●─●─●');
      expect(text).toContain('stale 7/12');
      expect(text).toContain('overdue 0/7 +2');
    });

    test(`shows a stopped run as stopped and keeps it out of the history on ${surface}`, async ($, on) => {
      const host = fakeHost(on);
      await startSync($);
      await $.tool.call({ tool: `${MCP}knowledge_lint` });
      await host.clock.advance(20_000);
      await $.turn.complete({ answer: '', durationMs: 0, isAborted: true, turnId: 't1', reason: 'aborted' });
      const text = await bandText($, surface);
      expect(text).toContain('■ sync · stopped · 20s');
      expect(text).toContain('●─●─◉─○');
      expect(host.store.get('sync-history')).toBeUndefined();
    });

    test(`measures once more when the turn ends, after the stats call on ${surface}`, async ($, on) => {
      const host = fakeHost(on);
      await startSync($);
      await $.tool.call({ tool: 'mcp__agent-kevin__sync_stats' });
      host.brainStale = 2;
      await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' });
      expect(await bandText($, surface)).toContain('stale 10/12');
    });
  }
});
