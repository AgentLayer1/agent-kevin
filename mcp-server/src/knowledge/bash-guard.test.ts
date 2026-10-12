import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homeRelativeLeak, shellGuard } from './bash-guard';

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
    expect(homeRelativeLeak(`(cd -- "${repo}" && echo x > projects/sub.md)`, home, home)).toBe('projects/sub.md');
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
    expect(
      homeRelativeLeak("cat > notes.md <<'EOF'\nSee knowledge/index.md for the map.\nEOF", repo, home)
    ).toBeUndefined();
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

const claude = (command: string, cwd = home): string | undefined => shellGuard(command, cwd, home, 'claude');

describe('shellGuard: directory drift', () => {
  test('refuses a top-level cd that leaves the session outside the home', () => {
    expect(claude(`cd ${repo} && git status`)).toContain(`working directory at ${repo}`);
    expect(claude(`cd ${repo}; ls`)).toContain('carries over');
    expect(claude(`pushd ${repo}`)).toContain('Blocked');
    expect(claude(`{ cd ${repo}; }`)).toContain('Blocked');
    expect(claude('cd')).toContain('Blocked');
  });

  test('lets a computed target through, and catches it on the next command if it left the home', () => {
    expect(claude('cd "$HOME_DIR" && ls')).toBeUndefined();
    expect(claude('cd - && ls')).toBeUndefined();
    expect(claude('popd')).toBeUndefined();
    expect(claude('make', repo)).toContain('because an earlier cd moved it');
  });

  test('refuses any command while the session has already drifted, until it returns', () => {
    expect(claude('git status', repo)).toContain(`working directory is ${repo}`);
    expect(claude(`cd ${home}`, repo)).toBeUndefined();
    expect(claude(`cd ${home} && git status`, repo)).toBeUndefined();
  });

  test('allows a cd that does not outlive the command', () => {
    expect(claude(`git -C ${repo} status`)).toBeUndefined();
    expect(claude(`(cd ${repo} && make)`)).toBeUndefined();
    expect(claude(`ROOT=$(cd ${repo} && pwd) && echo "$ROOT"`)).toBeUndefined();
    expect(claude(`cd ${repo} && make && cd ${home}`)).toBeUndefined();
    expect(claude('cd projects && ls')).toBeUndefined();
    expect(claude(`echo "cd ${repo}"`)).toBeUndefined();
    expect(claude(`cat > notes.md <<'EOF'\ncd ${repo}\nEOF`)).toBeUndefined();
  });

  test('is skipped under Codex, which starts every command in the workspace', () => {
    expect(shellGuard(`cd ${repo} && git status`, home, home, 'codex')).toBeUndefined();
  });
});

describe('shellGuard: shared temp dir', () => {
  test('refuses finding scratch by pattern', () => {
    expect(claude('ls -d /tmp/claude-501/mmd-* | head -1')).toContain('by pattern');
    expect(claude('bun run /tmp/claude-501/jsdom-*/check.ts')).toContain('by pattern');
    expect(claude('W=$(ls -td "$TMPDIR"/radar-* | head -1)')).toContain('by pattern');
    expect(claude('rm -rf /private/tmp/claude-501/demo-?')).toContain('by pattern');
  });

  test('refuses listing or searching the temp dir itself', () => {
    expect(claude('ls -t "$TMPDIR" | head -1')).toContain('listing or searching');
    expect(claude("find /tmp/claude-501 -name 'mmd-*'")).toContain('listing or searching');
  });

  test('refuses a hand-picked $TMPDIR name, whatever the command does with it', () => {
    expect(claude('echo x > "$TMPDIR/orig-$$"')).toContain('hand-picked name');
    expect(claude('cat $TMPDIR/prompt.md')).toContain('hand-picked name');
    expect(claude('mkdir -p "${TMPDIR}/pull-7d/out"')).toContain('hand-picked name');
    expect(claude('bun x.ts --out="${TMPDIR:-/tmp}/report.json"')).toContain('hand-picked name');
  });

  test('allows mktemp and the path it printed', () => {
    expect(claude('T=$(mktemp "$TMPDIR/note-XXXXXX") && echo x > "$T" && git commit -F "$T"')).toBeUndefined();
    expect(claude('W=$(mktemp -d "${TMPDIR}/run-XXXXXX") && mkdir -p "$W/pages"')).toBeUndefined();
    expect(claude('cat /tmp/claude-501/run-tKyadL/pages/good.html')).toBeUndefined();
    expect(claude(`find "$W" -name '*.png'`)).toBeUndefined();
    expect(claude("grep -rn 'tmp/*' src")).toBeUndefined();
  });

  test('applies under Codex too', () => {
    expect(shellGuard('ls -d /tmp/x-* | head -1', home, home, 'codex')).toContain('by pattern');
  });
});
