import { describe, expect, test } from 'claude-code/testing';
import type { Engine, EngineCall } from 'claude-code/testing';

import { BAND_PROPS, CLI, HOME, PLUGIN, fakeHost, machine, run } from './fake-host';

describe('commands', () => {
  test('/capture runs the plugin CLI from the session root', async ($, on) => {
    const host = fakeHost(on);
    const { text } = await run($, 'capture', 'try mods for the band');
    expect(text).toBe('Saved to knowledge/raw/inbox/fixture.md');
    expect(host.argv.at(-1)?.slice(2)).toEqual(['capture', 'try mods for the band', '--kind=inbox']);
    expect(host.cwd.at(-1)).toBe(HOME);
  });

  test('the CLI is named after the plugin, not the agent', async ($, on) => {
    const host = fakeHost(on);
    await run($, 'capture', 'x');
    expect(host.argv.at(-1)?.[1]?.endsWith(`/bin/${CLI}`)).toBe(true);
  });

  test('/lesson routes to the feedback log', async ($, on) => {
    const host = fakeHost(on);
    await run($, 'lesson', 'never amend');
    expect(host.argv.at(-1)?.slice(2)).toEqual(['capture', 'never amend', '--kind=feedback']);
  });

  test('/capture without text prints usage and runs nothing', async ($, on) => {
    const host = fakeHost(on);
    const { text } = await run($, 'capture', ' ');
    expect(text).toBe('Usage: /capture <text>');
    expect(host.argv).toHaveLength(0);
  });

  test('/done closes the task by id', async ($, on) => {
    const host = fakeHost(on);
    expect((await run($, 'done', '  ')).text).toBe('Usage: /done <task-id>');
    expect((await run($, 'done', 'ac-001')).text).toBe('Closed ac-001');
    expect(host.argv.at(-1)?.slice(2)).toEqual(['task', 'close', 'ac-001']);
  });

  const typed = ($: Engine, text: string) => {
    const start = text.lastIndexOf(' ') + 1;
    // The kit raises `prompt.autocomplete` on `$.prompt`, but its 2.1.296 typings leave the call out.
    const prompt = $.prompt as unknown as { autocomplete: EngineCall<'prompt.autocomplete'> };
    return prompt.autocomplete({ text, cursor: text.length, token: text.slice(start), start });
  };

  const taskReads = (argv: string[][]) => argv.filter((args) => args.slice(2).join(' ') === 'task query').length;

  test('/done suggests id matches before title matches, in task list order, and never a blocked task', async ($, on) => {
    fakeHost(on);
    const { suggestions } = await typed($, '/done ac');
    expect(suggestions.map((row) => row.text)).toEqual(['ac-001', 'ac-002', 'ac-005', 'bx-001']);
    expect(suggestions[0]?.description).toBe('Licence fixture');
  });

  test('/done suggests under its namespaced name too', async ($, on) => {
    fakeHost(on);
    expect((await typed($, `/${PLUGIN}:done ac-001`)).suggestions.map((row) => row.text)).toEqual(['ac-001']);
  });

  test('/done also matches a word of the title', async ($, on) => {
    fakeHost(on);
    expect((await typed($, '/done licence')).suggestions.map((row) => row.text)).toEqual(['ac-001']);
  });

  test('a token that is not the argument of /done adds nothing and runs nothing', async ($, on) => {
    const host = fakeHost(on);
    expect((await typed($, '/capture ac')).suggestions).toEqual([]);
    expect((await typed($, '/done ac-001 ac')).suggestions).toEqual([]);
    expect(host.argv).toHaveLength(0);
  });

  test('/done reads the task list once a minute, and again after it closes one', async ($, on) => {
    const host = fakeHost(on);
    await typed($, '/done a');
    await typed($, '/done ac');
    expect(taskReads(host.argv)).toBe(1);
    await run($, 'done', 'ac-001');
    await typed($, '/done ac');
    expect(taskReads(host.argv)).toBe(2);
    await host.clock.advance(61_000);
    await typed($, '/done ac');
    expect(taskReads(host.argv)).toBe(3);
  });

  test('/done suggests nothing, and throws nothing, when the task list cannot be read', async ($, on) => {
    const host = fakeHost(on, machine({ failing: ['task query'] }));
    expect((await typed($, '/done a')).suggestions).toEqual([]);
    await typed($, '/done ac');
    expect(taskReads(host.argv)).toBe(1);
  });

  test("/today tells Claude the summary, with the sync stamp from the CLI's data folder", async ($, on) => {
    fakeHost(on);
    const result = await run($, 'today');
    expect(result.text).toBeUndefined();
    expect(result.context).toEqual(['🦊 2 overdue (ac-005, ac-001) · 1 due today (ac-002) · synced 4d ago']);
  });
});

describe('/today row', () => {
  const band = ($: Engine, surface: 'terminal' | 'desktop') =>
    $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS });
  const agenda = async ($: Engine, surface: 'terminal' | 'desktop') =>
    (await (await band($, surface)).findAll({ type: 'Text' })).map((element) => element.text).join('|');

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`shows the agenda above the prompt until dismissed on ${surface}`, async ($, on) => {
      fakeHost(on);
      expect(await agenda($, surface)).not.toContain('Today');
      await run($, 'today');
      const drawn = await agenda($, surface);
      expect(drawn).toContain('Today|');
      expect(drawn).toContain('Tue 10 Mar · 21 Ramadan 1447');
      expect(drawn).toContain('Overdue|  2');
      expect(drawn).toContain('P0  |ac-005  |Urgent fixture|  2d late');
      expect(drawn).toContain('P1  |ac-001  |Licence fixture|  9d late');
      expect(drawn).toContain('Due today|  1');
      expect(drawn).toContain('⟳ last sync 4d ago');
      await (await band($, surface)).press({ key: 'today:dismiss' });
      expect(await agenda($, surface)).not.toContain('Today');
    });
  }

  test("/today says so when today's state can't be read, and opens no row", async ($, on) => {
    fakeHost(on, machine({ failing: ['task query'] }));
    expect((await run($, 'today')).text).toBe("Couldn't read today's state: task query failed");
    expect(await agenda($, 'terminal')).not.toContain('Today');
  });

  test('/clear takes the row down', async ($, on) => {
    fakeHost(on);
    await run($, 'today');
    await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } });
    expect(await agenda($, 'terminal')).not.toContain('Today');
  });
});

describe('/session row', () => {
  const band = ($: Engine, surface: 'terminal' | 'desktop') =>
    $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS });
  const drawn = async ($: Engine, surface: 'terminal' | 'desktop') =>
    (await (await band($, surface)).findAll({ type: 'Text' })).map((element) => element.text).join('|');

  test("/session tells Claude this conversation's id and copies nothing by itself", async ($, on) => {
    const host = fakeHost(on);
    const result = await run($, 'session');
    expect(result.text).toBeUndefined();
    expect(result.context).toEqual(['Session id: session-1']);
    expect(host.copied).toEqual([]);
  });

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`shows the id above the prompt, copies it on Copy, and goes on Dismiss on ${surface}`, async ($, on) => {
      const host = fakeHost(on);
      expect(await drawn($, surface)).not.toContain('Session');
      await run($, 'session');
      expect(await drawn($, surface)).toContain('Session|session-1');
      await (await band($, surface)).press({ key: 'session:copy' });
      expect(host.copied).toEqual(['session-1']);
      expect(host.toasts).toEqual(['Session id copied']);
      await (await band($, surface)).press({ key: 'session:dismiss' });
      expect(await drawn($, surface)).not.toContain('Session');
    });
  }

  test('/clear takes the row down, since the next conversation has another id', async ($, on) => {
    fakeHost(on);
    await run($, 'session');
    await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } });
    expect(await drawn($, 'terminal')).not.toContain('Session');
  });
});
