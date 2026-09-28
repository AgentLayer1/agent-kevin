import { describe, expect, test } from 'bun:test';
import { isValidTransition, parseFrontmatter, serializeValue } from './schema';

describe('isValidTransition', () => {
  test('a blocked task can be cancelled outright', () => {
    // Killing abandoned work is common, and routing it blocked -> active -> cancelled
    // parked the task in `active` between the two hops, lying in the dashboard.
    expect(isValidTransition('blocked', 'cancelled')).toBe(true);
  });

  test('blocked still cannot jump straight to done', () => {
    expect(isValidTransition('blocked', 'done')).toBe(false);
  });

  test('cancelled is terminal', () => {
    expect(isValidTransition('cancelled', 'open')).toBe(false);
    expect(isValidTransition('cancelled', 'active')).toBe(false);
  });
});

describe('frontmatter round trip', () => {
  const task = (title: string, labels: string[]): string =>
    `---\nschema: 1\nid: ac-001\ntitle: ${serializeValue(title)}\ntype: task\nstatus: open\npriority: P2\nproject: acme\nassignee: [ada]\nlabels: ${serializeValue(labels)}\ncreated: 2026-01-01\nupdated: 2026-01-01\ndue:\ndepends_on: []\nblocked_by:\nparent:\nclosed:\n---\n`;

  test('a title with quotes and backslashes comes back unchanged and stays valid YAML', () => {
    const title = 'Build a "voice of Ada" profile: C:\\notes';
    const raw = task(title, ['tax', 'obl:acme:form-c:2026-12', 'say "hi"']);
    expect(parseFrontmatter(raw)?.title).toBe(title);
    expect(parseFrontmatter(raw)?.labels).toEqual(['tax', 'obl:acme:form-c:2026-12', 'say "hi"']);
    const block = raw.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    expect(() => Bun.YAML.parse(block)).not.toThrow();
  });

  test('an older unescaped title still reads', () => {
    const raw = task('x', []).replace('title: x', 'title: "Build a "voice of Ada" profile"');
    expect(parseFrontmatter(raw)?.title).toBe('Build a "voice of Ada" profile');
  });
});
