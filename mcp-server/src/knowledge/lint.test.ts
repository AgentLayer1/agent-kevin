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

describe('lint broken links', () => {
  test('resolves links to archived tasks and still flags missing ones', async () => {
    const archive = join(FOLDERS.PROJECTS, 'acme', 'tasks', 'archive');
    mkdirSync(archive, { recursive: true });
    writeFileSync(join(archive, 'ac-001-retired-task.md'), '---\nid: ac-001\nstatus: done\n---\n');
    mkdirSync(join(FOLDERS.KNOWLEDGE, 'concepts'), { recursive: true });
    writeFileSync(
      join(FOLDERS.KNOWLEDGE, 'concepts', 'acme-links.md'),
      '---\ntitle: Acme links\n---\n\nSee [[ac-001-retired-task|ac-001]], [[ac-001]] and [[ac-999-never-filed]].\n'
    );
    const report = readFileSync((await run()).reportPath, 'utf-8');
    expect(report).not.toContain('[[ac-001-retired-task]] in concepts/acme-links.md');
    expect(report).not.toContain('[[ac-001]] in concepts/acme-links.md');
    expect(report).toContain('[[ac-999-never-filed]] in concepts/acme-links.md points to non-existent article');
  });
});
