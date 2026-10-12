import { FOLDERS } from '@/config';
import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { livePins, projectHues, readPins } from './surfaces';

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

describe('projectHues', () => {
  test("reads a project README's hue, skipping one that is missing or out of range", () => {
    const project = (name: string, readme: string) => {
      mkdirSync(join(FOLDERS.PROJECTS, name), { recursive: true });
      writeFileSync(join(FOLDERS.PROJECTS, name, 'README.md'), readme);
    };
    project('alpha', '---\naudience: [ada]\nhue: 121\n---\n\n# Alpha\n');
    project('beta', '---\nhue: 400\n---\n');
    project('gamma', '# Gamma\n\nhue: 10\n');
    expect(projectHues()).toMatchObject({ alpha: 121 });
    expect(Object.keys(projectHues())).not.toContain('beta');
    expect(Object.keys(projectHues())).not.toContain('gamma');
    ['alpha', 'beta', 'gamma'].forEach((name) => rmSync(join(FOLDERS.PROJECTS, name), { recursive: true, force: true }));
  });
});
