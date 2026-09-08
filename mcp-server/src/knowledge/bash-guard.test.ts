import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homeRelativeLeak } from './bash-guard';

const root = mkdtempSync(join(tmpdir(), 'bash-guard-'));
const home = join(root, 'Agents', 'Scout');
const repo = join(root, 'Developer', 'acme');
mkdirSync(join(home, 'projects'), { recursive: true });
mkdirSync(repo, { recursive: true });
process.on('exit', () => rmSync(root, { recursive: true, force: true }));

describe('homeRelativeLeak', () => {
  test('flags a home tree written relatively from a cwd outside the home', () => {
    expect(
      homeRelativeLeak("mkdir -p projects/blog-dev/posts && cat > projects/blog-dev/posts/outline.md <<'EOF'", repo, home)
    ).toBe('projects/blog-dev/posts');
    expect(homeRelativeLeak('echo hi >> knowledge/memory/index.md', repo, home)).toBe('knowledge/memory/index.md');
    expect(homeRelativeLeak("cat > 'reports/plans/a b.md'", repo, home)).toBe('reports/plans/a b.md');
    expect(homeRelativeLeak('touch ./reports/x.md', repo, home)).toBe('./reports/x.md');
  });

  test('follows a cd inside the command, so a single-line drift is caught from the home', () => {
    expect(homeRelativeLeak(`cd ${repo} && mkdir -p projects/x && echo hi > projects/x/note.md`, home, home)).toBe(
      'projects/x'
    );
    expect(homeRelativeLeak(`cd ${repo}; echo x > knowledge/index.md`, home, home)).toBe('knowledge/index.md');
    expect(homeRelativeLeak(`pushd ${repo} && echo x > projects/y.md`, home, home)).toBe('projects/y.md');
    expect(homeRelativeLeak(`cd ../../Developer/acme && touch projects/z`, home, home)).toBe('projects/z');
  });

  test('a cd back into the home clears the drift', () => {
    expect(homeRelativeLeak(`cd ${home} && echo x > projects/TASKS.md`, repo, home)).toBeUndefined();
    expect(homeRelativeLeak(`cd ${repo} && pwd && cd ${home} && touch projects/a`, home, home)).toBeUndefined();
  });

  test('a cd to a value the shell computes leaves the cwd unknown, which allows', () => {
    expect(homeRelativeLeak('cd "$AGENT_HOME" && echo x > projects/a.md', repo, home)).toBeUndefined();
    expect(homeRelativeLeak('cd $(git rev-parse --show-toplevel) && touch projects/a', repo, home)).toBeUndefined();
    expect(homeRelativeLeak('cd - && touch projects/a', repo, home)).toBeUndefined();
  });

  test('reads and mentions are not writes', () => {
    expect(homeRelativeLeak('cat knowledge/memory/index.md', repo, home)).toBeUndefined();
    expect(homeRelativeLeak("grep -rn 'projects/' mcp-server/src", repo, home)).toBeUndefined();
    expect(homeRelativeLeak('git commit -m "docs: note projects/ layout"', repo, home)).toBeUndefined();
    expect(homeRelativeLeak("cat > notes.md <<'EOF'\nSee knowledge/index.md for the map.\nEOF", repo, home)).toBeUndefined();
    expect(homeRelativeLeak('git add . && git commit -m "projects/ done"', repo, home)).toBeUndefined();
  });

  test('allows the same writes from the home or a directory inside it', () => {
    expect(homeRelativeLeak('mkdir -p projects/blog-dev/posts', home, home)).toBeUndefined();
    expect(homeRelativeLeak('echo x > knowledge/index.md', join(home, 'projects'), home)).toBeUndefined();
    expect(homeRelativeLeak('cd projects && touch a', home, home)).toBeUndefined();
  });

  test('allows absolute and variable-rooted paths from anywhere', () => {
    expect(homeRelativeLeak(`echo x > ${home}/projects/TASKS.md`, repo, home)).toBeUndefined();
    expect(homeRelativeLeak('tee "$HOME_DIR/knowledge/a.md"', repo, home)).toBeUndefined();
    expect(homeRelativeLeak('cp a ~/Documents/Agents/Scout/projects/', repo, home)).toBeUndefined();
  });

  test("allows a tree the effective cwd really has, because that one is the repo's", () => {
    mkdirSync(join(repo, 'projects'), { recursive: true });
    expect(homeRelativeLeak('touch projects/api/x', repo, home)).toBeUndefined();
    expect(homeRelativeLeak(`cd ${repo} && mkdir projects/api`, home, home)).toBeUndefined();
  });

  test('ignores words that merely contain a tree name', () => {
    expect(homeRelativeLeak('mkdir reports-archive', repo, home)).toBeUndefined();
    expect(homeRelativeLeak('echo x > myprojects/a.md', repo, home)).toBeUndefined();
  });
});
