import { describe, expect, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';

import type { Notice } from '../types';
import type { FakeHost } from './fake-host';
import { BAND_PROPS, HOME, PLUGIN, fakeHost, machine } from './fake-host';

const SURFACES = ['terminal', 'desktop'] as const;

const UPGRADE: Notice = {
  id: 'upgrade',
  level: 'nudge',
  pinned: true,
  icon: '↑',
  label: 'Upgrade',
  title: 'Upgrade ready',
  facts: [{ text: '0.6.5 → 0.7.0', tone: 'accent' }, { text: '1 release behind' }],
  command: `${PLUGIN}:upgrade`,
  actionLabel: 'Upgrade now'
};

const SYNC: Notice = {
  id: 'sync',
  level: 'nudge',
  pinned: true,
  icon: '⟳',
  label: 'Sync',
  title: 'Brain 5 days behind',
  facts: [{ text: '9 session logs', tone: 'warn' }],
  command: `${PLUGIN}:sync`,
  actionLabel: 'Sync now'
};

const start = async ($: Engine, host: FakeHost) => {
  await $.session.start({ cwd: HOME, surface: 'terminal', isInteractive: true });
  await host.clock.advance(0);
};

const band = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS });

const shown = async ($: Engine, surface: (typeof SURFACES)[number]) =>
  (await (await band($, surface)).findAll({ type: 'Text' })).map((element) => element.text).join(' ');

const recorded = (argv: string[][]) =>
  argv.filter((args) => args[2] === 'notices' && args[3] === 'record').map((args) => args.slice(4));

describe('notices at session start', () => {
  test('the top notice is suggested in the prompt box', async ($, on) => {
    const host = fakeHost(on, machine({ notices: [UPGRADE, SYNC] }));
    await start($, host);
    expect(host.suggestions).toEqual([`/${PLUGIN}:upgrade`]);
  });

  test('only an alert raises a toast', async ($, on) => {
    const host = fakeHost(on, machine({ notices: [SYNC] }));
    await start($, host);
    expect(host.toasts).toEqual([]);
  });

  test('an alert raises a toast naming the command', async ($, on) => {
    const host = fakeHost(on, machine({ notices: [{ ...SYNC, level: 'alert' }] }));
    await start($, host);
    expect(host.toasts).toEqual(['⟳  Brain 5 days behind. Tab to sync now.']);
  });

  test('the toast, Tab and the row all lead with the first notice', async ($, on) => {
    const host = fakeHost(
      on,
      machine({
        notices: [
          { ...UPGRADE, level: 'alert' },
          { ...SYNC, level: 'alert' }
        ]
      })
    );
    await start($, host);
    expect(host.toasts).toEqual(['↑  Upgrade ready. Tab to upgrade now.']);
    expect(host.suggestions).toEqual([`/${PLUGIN}:upgrade`]);
    expect((await (await band($, 'terminal')).findAll({ type: 'Button' }))[0]?.props.label).toBe('Upgrade now');
  });

  test('nothing to say suggests nothing', async ($, on) => {
    const host = fakeHost(on);
    await start($, host);
    expect([host.suggestions, host.toasts]).toEqual([[], []]);
  });
});

describe('the notice row', () => {
  for (const surface of SURFACES) {
    test(`draws the most important notice with its icon colored by level on ${surface}`, async ($, on) => {
      const host = fakeHost(on, machine({ notices: [UPGRADE, SYNC] }));
      await start($, host);
      const row = await band($, surface);
      const icon = await row.find({ type: 'Text', text: '↑ ' });
      expect(icon?.props.color).toBe('yellow');
      expect((await row.find({ type: 'Text', text: '0.6.5 → 0.7.0' }))?.props.color).toBe('cyan');
      expect(await shown($, surface)).toContain('+1 more');
      expect((await row.findAll({ type: 'Button' })).map((button) => button.props.label)).toEqual([
        'Upgrade now',
        'Tomorrow'
      ]);
    });

    test(`a hint stays out of the row on ${surface}`, async ($, on) => {
      const host = fakeHost(on, machine({ notices: [{ ...SYNC, level: 'hint' }] }));
      await start($, host);
      expect(await (await band($, surface)).findAll({ type: 'Button' })).toEqual([]);
    });

    test(`acting runs the command at once and steps the row aside on ${surface}`, async ($, on) => {
      const host = fakeHost(on, machine({ notices: [SYNC] }));
      await start($, host);
      const row = await band($, surface);
      await row.press({ key: 'notice:sync:act' });
      expect(host.commands).toEqual([`${PLUGIN}:sync`]);
      expect(await (await band($, surface)).findAll({ type: 'Button' })).toEqual([]);
    });

    test(`tomorrow snoozes it and draws what is left on ${surface}`, async ($, on) => {
      const host = fakeHost(on, machine({ notices: [UPGRADE, SYNC] }));
      await start($, host);
      const row = await band($, surface);
      host.notices = [SYNC];
      await row.press({ key: 'notice:upgrade:snooze' });
      expect(recorded(host.argv)).toEqual([['upgrade', '--outcome=snoozed']]);
      expect(await shown($, surface)).toContain('Brain 5 days behind');
      expect(await shown($, surface)).not.toContain('+1 more');
    });
  }

  test('the sync notice carries the average run time once there is a history', async ($, on) => {
    const host = fakeHost(on, machine({ notices: [SYNC] }));
    host.store.set('sync-history', [
      { endedAt: 1, totalMs: 300_000, after: null },
      { endedAt: 2, totalMs: 420_000, after: null }
    ]);
    await start($, host);
    expect(await shown($, 'terminal')).toContain('~6m');
  });
});

describe('acting by hand', () => {
  test('a typed command counts as acting, and the row refreshes when the turn ends', async ($, on) => {
    const host = fakeHost(on, machine({ notices: [SYNC] }));
    await start($, host);
    await $.skill.prompt({ skill: `${PLUGIN}:sync`, text: 'SYNC PROTOCOL' });
    expect(recorded(host.argv)).toEqual([['sync', '--outcome=acted']]);
    expect(await (await band($, 'terminal')).findAll({ type: 'Button' })).toEqual([]);
    host.notices = [];
    await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' });
    await host.clock.advance(0);
    expect(host.argv.filter((args) => args.slice(2).join(' ') === 'notices')).toHaveLength(2);
  });

  test('the periodic refresh keeps the row aside while the run is still going', async ($, on) => {
    const host = fakeHost(on, machine({ notices: [SYNC] }));
    await start($, host);
    await $.skill.prompt({ skill: `${PLUGIN}:sync`, text: 'SYNC PROTOCOL' });
    await host.clock.advance(30 * 60_000);
    expect(await (await band($, 'terminal')).findAll({ type: 'Button' })).toEqual([]);
  });

  test('a press whose command never starts a turn gives the row back when the next turn ends', async ($, on) => {
    const host = fakeHost(on, machine({ notices: [SYNC] }));
    await start($, host);
    await (await band($, 'terminal')).press({ key: 'notice:sync:act' });
    await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' });
    await host.clock.advance(0);
    expect((await (await band($, 'terminal')).findAll({ type: 'Button' })).length).toBe(2);
  });

  test('other skills leave the notices alone', async ($, on) => {
    const host = fakeHost(on, machine({ notices: [SYNC] }));
    await start($, host);
    await $.skill.prompt({ skill: `${PLUGIN}:focus`, text: 'FOCUS' });
    expect(recorded(host.argv)).toEqual([]);
  });
});
