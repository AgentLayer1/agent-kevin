import { describe, expect, test } from 'claude-code/testing';
import type { Engine, EngineCall } from 'claude-code/testing';
import type { On } from 'claude-code';

import { linkTaskIds } from '../tasks/link';
import { clip, normalizeId, parseTaskArgs, progressBar } from '../tasks/task';
import { BAND_PROPS, PLUGIN, fakeHost, machine, run } from './fake-host';

const HREF = 'file:///fixture/home/projects/acme/tasks/ac-001-fixture%20task.md';

describe('task helpers', () => {
  test('an id is lowercased and padded to three digits', () => {
    expect(normalizeId('zx-82')).toBe('zx-082');
    expect(normalizeId(' ZX-042 ')).toBe('zx-042');
    expect(normalizeId('qa-1234')).toBe('qa-1234');
  });

  test('arguments read as an id and an optional verb, archive meaning cancel', () => {
    expect(parseTaskArgs('')).toEqual({ kind: 'usage' });
    expect(parseTaskArgs('ac-1 done now')).toEqual({ kind: 'usage' });
    expect(parseTaskArgs('ac-1')).toEqual({ kind: 'task', id: 'ac-001' });
    expect(parseTaskArgs('ac-1 DONE')).toEqual({ kind: 'task', id: 'ac-001', verb: 'done' });
    expect(parseTaskArgs('ac-1 archive')).toEqual({ kind: 'task', id: 'ac-001', verb: 'cancel' });
    expect(parseTaskArgs('ac-1 shelve')).toEqual({ kind: 'unknown-verb', id: 'ac-001', verb: 'shelve' });
  });

  test('a long summary is cut on a word with an ellipsis', () => {
    expect(clip('short', 40)).toBe('short');
    expect(clip('one two three four five', 14)).toBe('one two three…');
  });

  test('the checklist bar fills in proportion', () => {
    expect(progressBar(0, 4)).toBe('▱▱▱▱▱▱▱▱');
    expect(progressBar(1, 4)).toBe('▰▰▱▱▱▱▱▱');
    expect(progressBar(4, 4)).toBe('▰▰▰▰▰▰▰▰');
  });
});

describe('task ids in replies', () => {
  const hrefs = new Map([
    ['qa-013', 'file:///h/qa-013.md'],
    ['zx-042', 'file:///h/zx-042-a%20b.md']
  ]);

  test('a bare known id becomes a link', () => {
    expect(linkTaskIds('See zx-042 first.', hrefs)).toBe('See [zx-042](file:///h/zx-042-a%20b.md) first.');
  });

  test('an inline code span that is exactly an id is linked whole', () => {
    expect(linkTaskIds('Open `zx-042`.', hrefs)).toBe('Open [`zx-042`](file:///h/zx-042-a%20b.md).');
  });

  test('unknown ids, longer ids, paths, code, links and wikilinks stay as written', () => {
    const untouched = [
      'x-123 and ab-999 are not tasks',
      'qa-0135 is another id',
      'projects/acme/tasks/zx-042-fix.md',
      'zx-042-mac is a file stem',
      '```\nzx-042\n```',
      '`run zx-042 now`',
      '[the task](https://example.com/zx-042)',
      '[[zx-042-mac|zx-042]]',
      'https://example.com/zx-042'
    ];
    untouched.forEach((text) => expect(linkTaskIds(text, hrefs)).toBe(text));
  });

  test('ids around protected spans are still linked', () => {
    expect(linkTaskIds('qa-013 then `code` then zx-042', hrefs)).toBe(
      '[qa-013](file:///h/qa-013.md) then `code` then [zx-042](file:///h/zx-042-a%20b.md)'
    );
  });
});

const typed = ($: Engine, text: string) => {
  const start = text.lastIndexOf(' ') + 1;
  // The kit raises `prompt.autocomplete` on `$.prompt`, but its 2.1.296 typings leave the call out.
  const prompt = $.prompt as unknown as { autocomplete: EngineCall<'prompt.autocomplete'> };
  return prompt.autocomplete({ text, cursor: text.length, token: text.slice(start), start });
};

const taskReads = (argv: string[][]) => argv.filter((args) => args.slice(2).join(' ') === 'task query').length;
const writes = (argv: string[][]) =>
  argv.map((args) => args.slice(2).join(' ')).filter((args) => /^task (close|update)/.test(args));

describe('/task', () => {
  test('shows the card and tells Claude one line about it', async ($, on) => {
    fakeHost(on);
    const result = await run($, 'task', 'AC-1');
    expect(result.text).toBeUndefined();
    expect(result.context).toEqual(['ac-001 · Licence fixture · active · P1 · acme · due Mar 1 · checklist 1/4']);
  });

  test('answers usage, an unknown verb and an unknown id in one line', async ($, on) => {
    const host = fakeHost(on);
    expect((await run($, 'task', ' ')).text).toBe('Usage: /task <id> [done|cancel]');
    expect((await run($, 'task', 'ac-001 shelve')).text).toBe(
      'Unknown action "shelve". Usage: /task <id> [done|cancel]'
    );
    expect((await run($, 'task', 'ac-999')).text).toBe('No task ac-999');
    expect(writes(host.argv)).toEqual([]);
  });

  test('done closes a live task, and cancel or archive cancels one', async ($, on) => {
    const host = fakeHost(on);
    expect((await run($, 'task', 'ac-002 done')).text).toBe('Closed ac-002');
    expect((await run($, 'task', 'ac-005 archive')).text).toBe('Cancelled ac-005');
    expect((await run($, 'task', 'ac-006 cancel')).text).toBe('Cancelled ac-006');
    expect(writes(host.argv)).toEqual([
      'task close ac-002',
      'task update ac-005 --status=cancelled',
      'task update ac-006 --status=cancelled'
    ]);
  });

  test('refuses a verb on a closed task without touching it', async ($, on) => {
    const host = fakeHost(on);
    expect((await run($, 'task', 'ac-003 done')).text).toBe('ac-003 is already done');
    expect((await run($, 'task', 'ac-003 cancel')).text).toBe('ac-003 is already done');
    expect(writes(host.argv)).toEqual([]);
  });

  test('/done no longer closes anything', async ($, on) => {
    const host = fakeHost(on);
    await run($, 'done', 'ac-001');
    expect(host.commands).toEqual(['done']);
    expect(writes(host.argv)).toEqual([]);
  });
});

describe('/task autocomplete', () => {
  test('suggests live tasks before closed ones, id matches before title matches', async ($, on) => {
    fakeHost(on);
    const { suggestions } = await typed($, '/task ac');
    expect(suggestions.map((row) => row.text)).toEqual(['ac-001', 'ac-002', 'ac-005', 'ac-006', 'bx-001', 'ac-003']);
    expect(suggestions[0]?.description).toBe('Licence fixture');
  });

  test('suggests under its namespaced name too', async ($, on) => {
    fakeHost(on);
    expect((await typed($, `/${PLUGIN}:task ac-001`)).suggestions.map((row) => row.text)).toEqual(['ac-001']);
  });

  test('offers only the verbs the task can take', async ($, on) => {
    fakeHost(on);
    expect((await typed($, '/task ac-2 ')).suggestions.map((row) => row.text)).toEqual(['done', 'cancel']);
    expect((await typed($, '/task ac-002 ca')).suggestions.map((row) => row.text)).toEqual(['cancel']);
    expect((await typed($, '/task ac-003 ')).suggestions).toEqual([]);
  });

  test('a token outside /task adds nothing and runs nothing', async ($, on) => {
    const host = fakeHost(on);
    expect((await typed($, '/capture ac')).suggestions).toEqual([]);
    expect((await typed($, '/task ac-001 done x')).suggestions).toEqual([]);
    expect(host.argv).toHaveLength(0);
  });

  test('reads the task list once a minute, and again after a verb', async ($, on) => {
    const host = fakeHost(on);
    await typed($, '/task a');
    await typed($, '/task ac');
    expect(taskReads(host.argv)).toBe(1);
    await run($, 'task', 'ac-002 done');
    await typed($, '/task ac');
    expect(taskReads(host.argv)).toBe(2);
    await host.clock.advance(61_000);
    await typed($, '/task ac');
    expect(taskReads(host.argv)).toBe(3);
  });

  test('suggests nothing, and throws nothing, when the task list cannot be read', async ($, on) => {
    fakeHost(on, machine({ failing: ['task query'] }));
    expect((await typed($, '/task a')).suggestions).toEqual([]);
  });
});

describe('/task card', () => {
  const band = ($: Engine, surface: 'terminal' | 'desktop') =>
    $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS });
  const drawn = async ($: Engine, surface: 'terminal' | 'desktop') =>
    (await (await band($, surface)).findAll({ type: 'Text' })).map((element) => element.text).join('|');

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`lays the task out, closes it on Done, and goes on Dismiss on ${surface}`, async ($, on) => {
      const host = fakeHost(on);
      expect(await drawn($, surface)).not.toContain('Licence fixture');
      await run($, 'task', 'ac-001');
      const card = await drawn($, surface);
      expect(card).toContain('ac-001|Licence fixture');
      expect(card).toContain('● active|·|P1|·|acme|·|');
      expect(card).toMatch(/due Mar 1 · \d+d late/);
      expect(card).toContain('Bug. The ac-001 fixture breaks.');
      expect(card).not.toContain('Second paragraph');
      expect(card).toContain('▰▰▱▱▱▱▱▱|1 of 4');
      const links = await (await band($, surface)).findAll({ type: 'Link' });
      expect(links.map((link) => link.props.href)).toEqual(surface === 'terminal' ? [HREF] : []);
      await (await band($, surface)).press({ key: 'task:done' });
      expect(host.statuses['ac-001']).toBe('done');
      expect(await drawn($, surface)).toContain('✓ done');
      expect(await (await band($, surface)).findAll({ type: 'Button' })).toHaveLength(1);
      await (await band($, surface)).press({ key: 'task:dismiss' });
      expect(await drawn($, surface)).not.toContain('Licence fixture');
    });
  }

  test('a typed verb refreshes the card when it shows that task', async ($, on) => {
    fakeHost(on);
    await run($, 'task', 'ac-002');
    await run($, 'task', 'ac-002 cancel');
    expect(await drawn($, 'terminal')).toContain('✕ cancelled');
  });

  test('/clear takes the card down', async ($, on) => {
    fakeHost(on);
    await run($, 'task', 'ac-001');
    await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } });
    expect(await drawn($, 'terminal')).not.toContain('Licence fixture');
  });
});

describe('reply links', () => {
  const drawnText = (on: On) => {
    const texts: string[] = [];
    on('ui.render', { component: 'AssistantMessage' }, (_$, e) => {
      texts.push(e.props.text);
      return { type: 'Box' as const };
    });
    return texts;
  };
  const reply = ($: Engine, text: string) =>
    $.ui.render({
      surface: 'terminal',
      component: 'AssistantMessage',
      requestId: 'message-1',
      props: { text, isFirstOfReply: true }
    });

  test('known ids draw as file links once the list is read', async ($, on) => {
    fakeHost(on);
    const texts = drawnText(on);
    await typed($, '/task a');
    await reply($, 'Next up: ac-001, then zz-999.');
    expect(texts).toEqual([`Next up: [ac-001](${HREF}), then zz-999.`]);
  });

  test('a cold list draws the reply unchanged and starts one read in the background', async ($, on) => {
    const host = fakeHost(on);
    const texts = drawnText(on);
    await reply($, 'Next up: ac-001.');
    expect(texts).toEqual(['Next up: ac-001.']);
    expect(taskReads(host.argv)).toBe(1);
  });

  test('the desktop draws the reply as written, since it opens no file: link', async ($, on) => {
    fakeHost(on);
    const texts = drawnText(on);
    await typed($, '/task a');
    await $.ui.render({
      surface: 'desktop',
      component: 'AssistantMessage',
      requestId: 'message-1',
      props: { text: 'Next up: ac-001.', isFirstOfReply: true }
    });
    expect(texts).toEqual(['Next up: ac-001.']);
  });

  test('a reply with no id shape runs nothing', async ($, on) => {
    const host = fakeHost(on);
    drawnText(on);
    await reply($, 'Nothing to link here.');
    expect(host.argv).toHaveLength(0);
  });
});
