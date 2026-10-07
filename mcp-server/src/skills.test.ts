import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { LEGACY_RUNTIME_DIR, RUNTIME_DIR } from '@/shared/naming';
import { routerPlaybooks } from '@/shared/playbooks';
import { RETIRED_SKILLS } from '@/shared/retired-skills';
import { PHASES } from '../../mods/sync/phases';

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

  // The data dir moved to the shared `.state` in 0.7.0. The old name survives only beside the new one (the
  // checks that keep a home working until its upgrade moves it) or beside the release it belongs to.
  test('skill and template text names the old data dir only beside .state or a release', () => {
    const legacy = new RegExp(`\\${LEGACY_RUNTIME_DIR}(?![\\w.\\]])`);
    const files = [
      ...markdownFiles(SKILLS),
      ...markdownFiles(join(ROOT, 'templates')),
      join(ROOT, 'templates', '.gitignore')
    ];
    expect(
      files.flatMap((file) =>
        readFileSync(file, 'utf-8')
          .split('\n')
          .flatMap((line, index) =>
            legacy.test(line) && !line.includes(RUNTIME_DIR) && !/\b0\.[37]\.0\b/.test(line)
              ? [`${relative(ROOT, file)}:${index + 1}`]
              : []
          )
      )
    ).toEqual([]);
  });

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

describe("sync's progress mod", () => {
  const syncText = readFileSync(join(SKILLS, 'sync', 'SKILL.md'), 'utf-8');
  const flywheelText = readFileSync(join(SKILLS, 'flywheel', 'SKILL.md'), 'utf-8');
  const frontmatter = readFrontmatter('sync');
  const allowed =
    typeof frontmatter === 'object' && frontmatter !== null && 'allowed-tools' in frontmatter
      ? String(frontmatter['allowed-tools'])
          .split(',')
          .map((entry) => entry.trim())
      : [];
  const UNTRACKED = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'];
  const tracked = (key: 'tools' | 'scripts' | 'skills'): string[] => PHASES.flatMap((phase) => [...phase[key]]);
  const trackedTools = [...tracked('tools'), ...(PHASES.some((phase) => phase.reports.length) ? ['report_write'] : [])];

  test("maps every tool and skill in sync's allowed-tools to a phase", () => {
    const tools = allowed
      .filter((entry) => !entry.startsWith('Skill(') && !UNTRACKED.includes(entry))
      .map((entry) => (entry.includes('__') ? entry.slice(entry.lastIndexOf('__') + 2) : entry));
    const skills = allowed
      .filter((entry) => entry.startsWith('Skill('))
      .map((entry) => entry.slice(entry.indexOf(':') + 1, -1));
    expect(tools.filter((tool) => !trackedTools.includes(tool))).toEqual([]);
    expect(skills.filter((skill) => !tracked('skills').includes(skill))).toEqual([]);
  });

  test('maps every script sync runs to a phase', () => {
    const scripts = [...syncText.matchAll(/\/scripts\/([\w-]+\.ts)/g)].map((match) => match[1] ?? '');
    expect([...new Set(scripts)].filter((script) => !tracked('scripts').includes(script))).toEqual([]);
  });

  test('every mapped name still appears in sync or the flywheel it runs', () => {
    const named = [...tracked('tools'), ...tracked('scripts'), ...tracked('skills')];
    expect(named.filter((name) => !syncText.includes(name) && !flywheelText.includes(name))).toEqual([]);
  });
});
