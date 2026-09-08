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
      homeRelativeLeak(
        "mkdir -p projects/blog-dev/posts && cat > projects/blog-dev/posts/outline.md <<'EOF'",
        repo,
        home
      )
    ).toBe('projects/blog-dev/posts');
    expect(homeRelativeLeak('cat knowledge/memory/index.md', repo, home)).toBe('knowledge/memory/index.md');
    expect(homeRelativeLeak('ls ./reports/', repo, home)).toBe('./reports/');
  });

  test('follows a cd inside the command, so a single-line drift is caught from the home', () => {
    expect(homeRelativeLeak(`cd ${repo} && mkdir -p projects/x && echo hi > projects/x/note.md`, home, home)).toBe(
      'projects/x'
    );
    expect(homeRelativeLeak(`cd ${repo}; cat knowledge/index.md`, home, home)).toBe('knowledge/index.md');
    expect(homeRelativeLeak(`cd ../../Developer/acme && ls projects/`, home, home)).toBe('projects/');
  });

  test('a cd back into the home clears the drift', () => {
    expect(homeRelativeLeak(`cd ${home} && cat projects/TASKS.md`, repo, home)).toBeUndefined();
    expect(homeRelativeLeak(`cd ${repo} && pwd && cd ${home} && ls projects/`, home, home)).toBeUndefined();
  });

  test('allows the same commands from the home or a directory inside it', () => {
    expect(homeRelativeLeak('mkdir -p projects/blog-dev/posts', home, home)).toBeUndefined();
    expect(homeRelativeLeak('cat knowledge/index.md', join(home, 'projects'), home)).toBeUndefined();
    expect(homeRelativeLeak('cd projects && ls', home, home)).toBeUndefined();
  });

  test('allows absolute and variable-rooted paths from anywhere', () => {
    expect(homeRelativeLeak(`cat ${home}/projects/TASKS.md`, repo, home)).toBeUndefined();
    expect(homeRelativeLeak('ls "$HOME_DIR/knowledge/"', repo, home)).toBeUndefined();
    expect(homeRelativeLeak('git log -- ~/Documents/Agents/Scout/projects', repo, home)).toBeUndefined();
  });

  test("allows a tree the effective cwd really has, because that one is the repo's", () => {
    mkdirSync(join(repo, 'projects'), { recursive: true });
    expect(homeRelativeLeak('ls projects/api', repo, home)).toBeUndefined();
    expect(homeRelativeLeak(`cd ${repo} && ls projects/api`, home, home)).toBeUndefined();
  });

  test('ignores words that merely contain a tree name', () => {
    expect(homeRelativeLeak('bun run reports-cli', repo, home)).toBeUndefined();
    expect(homeRelativeLeak('grep -rn "projects" src/', repo, home)).toBeUndefined();
  });
});
