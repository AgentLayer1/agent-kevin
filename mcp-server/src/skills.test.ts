import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { routerPlaybooks } from '@/shared/playbooks';
import { RETIRED_SKILLS } from '@/shared/retired-skills';

const ROOT = resolve(import.meta.dir, '..', '..');
const SKILLS = join(ROOT, 'skills');
const DESCRIPTION_CAP = 1024;
// Hosts list every model-invocable description up to a budget (Codex ~2% of the window, Claude Code 1%);
// this is the combined size after the playbook consolidation, and it only comes down.
const CATALOG_BUDGET = 16_200;
const SLASH_ONLY = ['init', 'release', 'rename-agent'];
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

  test('only the first-run wizard, the release cut and the brain-wide rename are slash-only', () => {
    const slashOnly = skillDirs.filter((skill) => {
      const frontmatter = readFrontmatter(skill);
      return (
        typeof frontmatter === 'object' &&
        frontmatter !== null &&
        'disable-model-invocation' in frontmatter &&
        frontmatter['disable-model-invocation'] === true
      );
    });
    expect(slashOnly.sort()).toEqual(SLASH_ONLY);
  });

  test.each(SLASH_ONLY)('%s also opts out of implicit invocation on Codex, which ignores the frontmatter flag', (skill) => {
    const policy = Bun.YAML.parse(readFileSync(join(SKILLS, skill, 'agents', 'openai.yaml'), 'utf-8'));
    expect(policy).toEqual({ policy: { allow_implicit_invocation: false } });
  });

  test(`model-invocable descriptions fit the ${CATALOG_BUDGET}-character catalog budget`, () => {
    const total = skillDirs
      .filter((skill) => !SLASH_ONLY.includes(skill))
      .reduce((sum, skill) => sum + (descriptionOf(skill)?.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(CATALOG_BUDGET);
  });

  test('relative links inside skill folders resolve', () => {
    expect(markdownFiles(SKILLS).flatMap(brokenLinks)).toEqual([]);
  });

  // Claude Code fills in ${CLAUDE_PLUGIN_ROOT} only in a loaded SKILL.md, never in a file read later,
  // and the Bash tool doesn't have the variable, so in a playbook it would run as `/skills/...`.
  const playbookFiles = skillDirs
    .filter((skill) => existsSync(join(SKILLS, skill, 'references')))
    .flatMap((skill) => markdownFiles(join(SKILLS, skill, 'references')).map((file) => ({ skill, file })));

  test('playbooks write <plugin root>, never CLAUDE_PLUGIN_ROOT', () => {
    expect(
      playbookFiles
        .filter(({ file }) => readFileSync(file, 'utf-8').includes('CLAUDE_PLUGIN_ROOT'))
        .map(({ file }) => relative(ROOT, file))
    ).toEqual([]);
  });

  test('a skill whose playbooks write <plugin root> states the path in its SKILL.md', () => {
    const skills = [
      ...new Set(
        playbookFiles
          .filter(({ file }) => readFileSync(file, 'utf-8').includes('<plugin root>'))
          .map(({ skill }) => skill)
      )
    ];
    expect(
      skills.filter(
        (skill) =>
          !readFileSync(join(SKILLS, skill, 'SKILL.md'), 'utf-8').includes('**Plugin root:** `${CLAUDE_PLUGIN_ROOT}`')
      )
    ).toEqual([]);
  });
});

describe('retired skills', () => {
  test('every successor is a live skill, never another retired one', () => {
    const routers = Object.values(RETIRED_SKILLS).map((command) => command.split(' ')[0] ?? '');
    expect(routers.filter((router) => !skillDirs.includes(router) || Object.hasOwn(RETIRED_SKILLS, router))).toEqual([]);
    expect(Object.keys(RETIRED_SKILLS).filter((retired) => skillDirs.includes(retired))).toEqual([]);
  });
});

describe.each(['briefing', 'engineer', 'focus', 'goals', 'media', 'project', 'seed', 'self-review', 'seo', 'tax'])(
  '%s help',
  (skill) => {
    test('lists every playbook the router names', () => {
      const router = readFileSync(join(SKILLS, skill, 'SKILL.md'), 'utf-8');
      const help = readFileSync(join(SKILLS, skill, 'references', 'help.md'), 'utf-8').toLowerCase();
      const playbooks = routerPlaybooks(router);
      expect(playbooks.length).toBeGreaterThan(0);
      expect(playbooks.filter((name) => !help.includes(`**${name.toLowerCase()}**`))).toEqual([]);
    });
  }
);
