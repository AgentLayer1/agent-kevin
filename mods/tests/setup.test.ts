import { describe, expect, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';

import type { FakeHost } from './fake-host';
import { BAND_PROPS, HOME, PLUGIN, fakeHost, machine } from './fake-host';

const SURFACES = ['terminal', 'desktop'] as const;
const INIT = `${PLUGIN}:init`;

const start = async ($: Engine, host: FakeHost) => {
  await $.session.start({ cwd: HOME, surface: 'terminal', isInteractive: true });
  await host.clock.advance(0);
};

const band = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS });

const shown = async ($: Engine, surface: (typeof SURFACES)[number]) =>
  (await (await band($, surface)).findAll({ type: 'Text' })).map((element) => element.text).join(' ');

describe('setup prompt', () => {
  for (const surface of SURFACES) {
    test(`a folder with no home offers init on ${surface}`, async ($, on) => {
      const host = fakeHost(on, machine({ files: {} }));
      await start($, host);
      expect(await shown($, surface)).toContain("Kevin isn't set up in this folder yet");
      expect(host.suggestions).toEqual([`/${INIT}`]);
    });

    test(`the button runs init and the row steps aside on ${surface}`, async ($, on) => {
      const host = fakeHost(on, machine({ files: {} }));
      await start($, host);
      await (await band($, surface)).press({ key: 'setup:init' });
      expect(host.commands).toEqual([INIT]);
      expect(await shown($, surface)).not.toContain('set up');
    });
  }

  const homes: Record<string, Record<string, string>> = {
    'a .state home': { [`${HOME}/.state/version.json`]: '{}' },
    'a home not yet moved off its legacy data dir': { [`${HOME}/.kevin/knowledge.json`]: '{}' },
    "a folder holding another home's SOUL.md": { [`${HOME}/SOUL.md`]: '# Soul' }
  };
  for (const [name, files] of Object.entries(homes)) {
    test(`${name} shows nothing`, async ($, on) => {
      const host = fakeHost(on, machine({ files }));
      await start($, host);
      expect(await shown($, 'terminal')).not.toContain('set up');
      expect(host.suggestions).not.toContain(`/${INIT}`);
    });
  }

  test('typing init by hand hides the row too', async ($, on) => {
    const host = fakeHost(on, machine({ files: {} }));
    await start($, host);
    await $.skill.prompt({ skill: INIT, text: 'INIT PROTOCOL' });
    expect(await shown($, 'terminal')).not.toContain('set up');
  });
});
