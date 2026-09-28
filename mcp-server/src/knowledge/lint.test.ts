import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FOLDERS } from '@/config';
import { run } from './lint';

const article = (name: string, frontmatter: string): void => {
  const dir = join(FOLDERS.KNOWLEDGE, 'concepts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), `---\n${frontmatter}\n---\n\n# ${name}\n\nBody text for ${name}.\n`);
};

describe('lint invalid frontmatter', () => {
  test('flags nested values and passes flat ones', async () => {
    article('acme-nested', 'title: Acme nested\nowner: { name: Ada }\nrepos:\n  - { name: acme, head: abc123 }');
    article('acme-flat', 'title: Acme flat\nsources: [raw/sessions/2026-01-01.md]\ncreated: 2026-01-01\ncount: 3');
    const summary = await run();
    const report = readFileSync(summary.reportPath, 'utf-8');
    expect(report).toContain('concepts/acme-nested.md frontmatter `owner:` holds nested data');
    expect(report).toContain('concepts/acme-nested.md frontmatter `repos:` holds nested data');
    expect(report).not.toContain('concepts/acme-flat.md frontmatter');
  });
});
