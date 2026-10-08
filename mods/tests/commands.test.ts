import { describe, expect, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';

import { CLI, HOME, PLUGIN, fakeHost, run } from './fake-host';

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

  test("/today reads the sync stamp from the CLI's data folder", async ($, on) => {
    fakeHost(on);
    const { text } = await run($, 'today');
    expect(text).toBe('🦊 2 overdue (ac-005, ac-001) · 1 due today (ac-002) · synced 4d ago');
  });
});

describe('/today agenda', () => {
  const agenda = async ($: Engine, surface: 'terminal' | 'desktop', text: string) => {
    const row = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'CommandOutput',
      props: { command: 'today', args: '', text, isErrored: false }
    });
    return (await row.findAll({ type: 'Text' })).map((element) => element.text).join('|');
  };

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`draws the agenda stored under the row's text on ${surface}`, async ($, on) => {
      fakeHost(on);
      const drawn = await agenda($, surface, (await run($, 'today')).text ?? '');
      expect(drawn).toContain('Today|');
      expect(drawn).toContain('Tue 10 Mar · 21 Ramadan 1447');
      expect(drawn).toContain('Overdue|  2');
      expect(drawn).toContain('P0  |ac-005  |Urgent fixture|  2d late');
      expect(drawn).toContain('P1  |ac-001  |Licence fixture|  9d late');
      expect(drawn).toContain('Due today|  1');
      expect(drawn).toContain('⟳ last sync 4d ago');
    });

    test(`leaves a row it has no stored view for to the plain text on ${surface}`, async ($, on) => {
      fakeHost(on);
      const row = await $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'CommandOutput',
        props: { command: 'today', args: '', text: 'an older summary', isErrored: false }
      });
      expect(await row.find({ key: 'plain-row' })).toBeDefined();
    });
  }
});
