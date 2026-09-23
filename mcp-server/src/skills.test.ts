import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..', '..');
const SKILLS = join(ROOT, 'skills');
const DESCRIPTION_CAP = 1024;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const LINK_RE = /\]\(([^)\s]+)\)/g;
const CODE_RE = /^(`{3,}|~{3,})[\s\S]*?^\1|`[^`\n]*`/gm;

const skillDirs = readdirSync(SKILLS).filter((entry) => existsSync(join(SKILLS, entry, 'SKILL.md')));

const readFrontmatter = (skill: string): unknown => {
  const raw = readFileSync(join(SKILLS, skill, 'SKILL.md'), 'utf-8');
  const block = raw.match(FRONTMATTER_RE)?.[1];
  if (block === undefined) {
    throw new Error(`${skill}/SKILL.md has no frontmatter block`);
  }
  return Bun.YAML.parse(block);
};

const descriptionOf = (skill: string): string | null => {
  const frontmatter = readFrontmatter(skill);
  if (typeof frontmatter !== 'object' || frontmatter === null || !('description' in frontmatter)) {
    return null;
  }
  return typeof frontmatter.description === 'string' ? frontmatter.description.trim() : null;
};

const markdownFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return markdownFiles(path);
    }
    return path.endsWith('.md') ? [path] : [];
  });

const isLocalLink = (target: string) =>
  !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith('#') && !target.startsWith('<');

const brokenLinks = (file: string): string[] =>
  [...readFileSync(file, 'utf-8').replace(CODE_RE, '').matchAll(LINK_RE)]
    .map((match) => match[1])
    .filter(isLocalLink)
    .filter((target) => !existsSync(resolve(dirname(file), target.split('#')[0])))
    .map((target) => `${relative(ROOT, file)} -> ${target}`);

describe('skills', () => {
  test.each(skillDirs)('%s has parseable frontmatter whose name matches its folder', (skill) => {
    expect(readFrontmatter(skill)).toMatchObject({ name: skill });
  });

  test.each(skillDirs)(
    `%s keeps its description within the ${DESCRIPTION_CAP}-character cap hosts truncate at`,
    (skill) => {
      const description = descriptionOf(skill);
      expect(description).not.toBeNull();
      expect(description?.length ?? 0).toBeLessThanOrEqual(DESCRIPTION_CAP);
    }
  );

  test('relative links inside skill folders resolve', () => {
    expect(markdownFiles(SKILLS).flatMap(brokenLinks)).toEqual([]);
  });
});
