import { FOLDERS } from '@/config';
import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { livePins, readPins } from './surfaces';

describe('readPins', () => {
  test('reads the link forms a markdown editor writes, each file once, and only inside the home', () => {
    const plans = join(FOLDERS.REPORTS, 'plans');
    mkdirSync(plans, { recursive: true });
    ['a b.md', 'a (1).md', 'x.md'].forEach((name) => writeFileSync(join(plans, name), 'x'));
    const pinned = join(FOLDERS.REPORTS, 'pinned.md');
    writeFileSync(
      pinned,
      [
        '# Pinned',
        '- 🏳️‍🌈 [Encoded](plans/a%20b.md)',
        '* [Anchor](plans/x.md#top)',
        '- [Parens](plans/a (1).md)',
        '- [Angle](<plans/a b.md>)',
        '- [Titled](plans/x.md "the plan")',
        '- [Q [draft]](plans/x.md)',
        '- **Bold** [Bold](plans/x.md)',
        '- [Hosts](/etc/hosts)'
      ].join('\n')
    );

    expect(readPins().map(({ icon, title, exists }) => ({ icon, title, exists }))).toEqual([
      { icon: '🏳️‍🌈', title: 'Encoded', exists: true },
      { icon: undefined, title: 'Anchor', exists: true },
      { icon: undefined, title: 'Parens', exists: true },
      { icon: undefined, title: 'Hosts', exists: false }
    ]);
    expect(livePins().map((pin) => pin.title)).toEqual(['Encoded', 'Anchor', 'Parens']);
    [pinned, plans].forEach((path) => rmSync(path, { recursive: true, force: true }));
  });
});
