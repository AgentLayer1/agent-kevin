import { describe, expect, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';
import type { On } from 'claude-code';

import { BAND_PROPS, PLUGIN, fakeHost, run } from './fake-host';

const SURFACES = ['terminal', 'desktop'] as const;

const queueHost = (on: On) => {
  const host = fakeHost(on);
  const submitted: string[] = [];
  on('prompt.submit', (_$, e) => {
    submitted.push(e.origin.kind === 'plugin' && e.origin.asUser ? e.text : `framed: ${e.text}`);
    return { text: e.text };
  });
  on('turn.start', (_$, e) => ({ turnId: e.turnId }));
  return { clock: host.clock, submitted };
};

const startTurn = ($: Engine) => $.turn.start({ text: '', turnId: 't1' });

const endTurn = ($: Engine, agentId?: string, reason: 'answer' | 'aborted' | 'error' = 'answer') =>
  $.turn.complete({
    answer: '',
    durationMs: 0,
    isAborted: reason === 'aborted',
    turnId: 't1',
    reason,
    ...(agentId ? { agentId } : {})
  });

const bandText = async ($: Engine, surface: (typeof SURFACES)[number]) => {
  const band = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS });
  return (await band.findAll({ type: 'Text' })).map((element) => element.text).join('');
};

describe('queue', () => {
  test('a /queue while idle goes out at once, as the person', async ($, on) => {
    const { clock, submitted } = queueHost(on);

    const result = await run($, 'queue', '  run the tests next  ');
    expect(submitted).toEqual([]);
    await clock.settle();

    expect(result.text).toBeUndefined();
    expect(submitted).toEqual(['run the tests next']);
  });

  test('a /queue typed before the last sent prompt starts its turn waits behind it', async ($, on) => {
    const { clock, submitted } = queueHost(on);

    await run($, 'queue', 'Q1');
    await run($, 'queue', 'Q2');
    await clock.settle();

    expect(submitted).toEqual(['Q1']);
  });

  test('/queues typed mid-turn wait for it, then go out one per turn, in order', async ($, on) => {
    const { clock, submitted } = queueHost(on);

    await startTurn($);
    await run($, 'queue', 'Q1');
    await run($, 'queue', 'Q2');
    await run($, 'queue', 'Q3');
    await clock.settle();
    expect(submitted).toEqual([]);

    await endTurn($);
    await clock.settle();
    expect(submitted).toEqual(['Q1']);

    await run($, 'queue', 'Q4');
    await clock.settle();
    expect(submitted).toEqual(['Q1']);

    await endTurn($);
    await clock.settle();
    await endTurn($);
    await clock.settle();
    await endTurn($);
    await clock.settle();
    expect(submitted).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
  });

  for (const surface of SURFACES) {
    test(`the row above the prompt counts what waits from the moment it is queued on ${surface}`, async ($, on) => {
      const { clock } = queueHost(on);
      expect(await bandText($, surface)).not.toContain('queued');

      await startTurn($);
      await run($, 'queue', 'Q1');
      await run($, 'queue', 'Q2');
      await clock.settle();
      expect(await bandText($, surface)).toContain('⏳ 2 queued');

      await endTurn($);
      await clock.settle();
      expect(await bandText($, surface)).toContain('⏳ 1 queued');

      await endTurn($);
      await clock.settle();
      expect(await bandText($, surface)).not.toContain('queued');
    });
  }

  test('/queue clear drops what waits and says how many', async ($, on) => {
    const { clock, submitted } = queueHost(on);

    await startTurn($);
    await run($, 'queue', 'Q1');
    await run($, 'queue', 'Q2');
    const result = await run($, 'queue', 'clear');
    await endTurn($);
    await clock.settle();

    expect(result.text).toBe('Cleared 2 queued prompts.');
    expect(submitted).toEqual([]);
  });

  for (const reason of ['aborted', 'error'] as const) {
    test(`a turn that ends ${reason} holds the queue until a turn ends normally`, async ($, on) => {
      const { clock, submitted } = queueHost(on);

      await startTurn($);
      await run($, 'queue', 'Q1');
      await run($, 'queue', 'Q2');
      await endTurn($, undefined, reason);
      await clock.settle();
      expect(submitted).toEqual([]);
      expect(await bandText($, 'terminal')).toContain('⏸ 2 queued (paused)');

      await run($, 'queue', 'Q3');
      await clock.settle();
      expect(submitted).toEqual([]);

      await startTurn($);
      await endTurn($);
      await clock.settle();
      expect(submitted).toEqual(['Q1']);
      expect(await bandText($, 'terminal')).toContain('⏳ 2 queued');
    });
  }

  test('/queue clear lifts a pause', async ($, on) => {
    const { clock, submitted } = queueHost(on);

    await startTurn($);
    await run($, 'queue', 'Q1');
    await endTurn($, undefined, 'aborted');
    await run($, 'queue', 'clear');
    await run($, 'queue', 'Q2');
    await clock.settle();

    expect(submitted).toEqual(['Q2']);
  });

  test("a subagent's turn ending does not release the next prompt", async ($, on) => {
    const { clock, submitted } = queueHost(on);

    await startTurn($);
    await run($, 'queue', 'Q1');
    await endTurn($, 'agent-1');
    await clock.settle();

    expect(submitted).toEqual([]);
  });

  test("a subagent's turn starting does not hold a /queue sent while the main loop is idle", async ($, on) => {
    const { clock, submitted } = queueHost(on);

    await $.turn.start({ text: '', turnId: 't2', agentId: 'agent-1' });
    await run($, 'queue', 'Q1');
    await clock.settle();

    expect(submitted).toEqual(['Q1']);
  });

  test('a turn ending with nothing queued submits nothing', async ($, on) => {
    const { clock, submitted } = queueHost(on);

    await startTurn($);
    await endTurn($);
    await clock.settle();

    expect(submitted).toEqual([]);
  });

  test('/queue with no prompt shows usage and queues nothing', async ($, on) => {
    const { clock, submitted } = queueHost(on);

    const result = await run($, 'queue', '   ');
    await clock.settle();

    expect(result.text).toBe('Usage: /queue <prompt>, or /queue clear');
    expect(submitted).toEqual([]);
  });
});
