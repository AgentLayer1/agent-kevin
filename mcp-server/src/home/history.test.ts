import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { followMove, type HistoryEnv, historyStatus, restorePointer, setupHistory } from '@/home/history';

let root: string;
let userHome: string;
let syncedRoot: string;
let historyEnv: HistoryEnv;

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const write = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

/** A scaffolded-looking home. No secrets store: the checks test its ignore rule by path. */
const makeHome = (parent: string, name = 'Ada'): string => {
  const home = join(parent, name);
  write(join(home, 'SOUL.md'), '# Soul\n');
  write(join(home, 'knowledge', 'index.md'), '# Index\n');
  write(join(home, '.kevin', 'knowledge.json'), '{}\n');
  write(join(home, '.kevin', 'logs', 'app.log'), 'runtime noise\n');
  return home;
};

const settingsOf = (home: string) =>
  JSON.parse(readFileSync(join(home, '.claude', 'settings.local.json'), 'utf-8')) as {
    env?: Record<string, string>;
    permissions?: { allow?: string[]; additionalDirectories?: string[] };
    sandbox?: { filesystem?: { allowWrite?: string[]; denyRead?: string[] } };
  };

const commitCount = (home: string): number => Number(git(home, 'rev-list', '--count', 'HEAD'));

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'home-history-')));
  userHome = join(root, 'user');
  syncedRoot = join(userHome, 'Documents');
  mkdirSync(syncedRoot, { recursive: true });
  historyEnv = { userHome, syncedBy: (path) => (path.startsWith(syncedRoot) ? 'iCloud Drive' : null) };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('setupHistory', () => {
  test('a home outside any synced folder gets history in place', () => {
    const home = makeHome(join(root, 'local'));
    const result = setupHistory(home, {}, historyEnv);
    expect(result.outcome).toBe('turned-on');
    expect(lstatSync(join(home, '.git')).isDirectory()).toBe(true);
    expect(result.status).toMatchObject({ state: 'on', layout: 'in-place' });
    expect(commitCount(home)).toBe(1);
    const tracked = git(home, 'ls-files').split('\n');
    expect(tracked).toContain('.kevin/knowledge.json');
    expect(tracked).not.toContain('.kevin/logs/app.log');
    expect(existsSync(join(home, '.claude', 'settings.local.json'))).toBe(false);
  });

  test('a synced home keeps its history in the local state folder, recorded with both grants', () => {
    const home = makeHome(syncedRoot);
    const gitDir = join(userHome, '.local', 'state', 'agent-kevin', 'Documents-Ada.git');
    expect(historyStatus(home, historyEnv).historyFolder).toBe(gitDir);
    const result = setupHistory(home, {}, historyEnv);
    expect(result.outcome).toBe('turned-on');
    expect(readFileSync(join(home, '.git'), 'utf-8')).toBe(`gitdir: ${gitDir}\n`);
    expect(settingsOf(home)).toEqual({
      env: { AGENT_HOME_GIT_DIR: gitDir },
      permissions: { additionalDirectories: [gitDir] },
      sandbox: { filesystem: { allowWrite: [gitDir] } }
    });
    expect(git(home, 'config', '--get', 'agent.home')).toBe(home);
  });

  test("a synced home outside the user's home folder is named by its full path", () => {
    const home = makeHome(join(root, 'volume'));
    const everywhereSynced = {
      ...historyEnv,
      syncedBy: (path: string) => (path.startsWith(join(root, 'volume')) ? 'Dropbox' : null)
    };
    const folder = historyStatus(home, everywhereSynced).historyFolder ?? '';
    expect(basename(folder)).toBe(`${join(root, 'volume', 'Ada').split(sep).filter(Boolean).join('-')}.git`);
  });

  test('a home outside any synced folder names no outside folder', () => {
    expect(historyStatus(makeHome(join(root, 'local')), historyEnv).historyFolder).toBeNull();
  });

  test('steps around a file where the history folder would go, and refuses a synced one', () => {
    const home = makeHome(syncedRoot);
    write(join(userHome, '.local', 'state', 'agent-kevin', 'Documents-Ada.git'), 'not a folder');
    expect(historyStatus(home, historyEnv).historyFolder).toBe(
      join(userHome, '.local', 'state', 'agent-kevin', 'Documents-Ada-2.git')
    );
    const everywhereSynced = { ...historyEnv, syncedBy: () => 'iCloud Drive' };
    expect(setupHistory(home, {}, everywhereSynced).outcome).toBe('refused');
    expect(existsSync(join(home, '.git'))).toBe(false);
  });

  test('a second run changes nothing', () => {
    const home = makeHome(syncedRoot);
    setupHistory(home, {}, historyEnv);
    const again = setupHistory(home, {}, historyEnv);
    expect(again.outcome).toBe('already-on');
    expect(again.settingsChanged).toBe(false);
    expect(commitCount(home)).toBe(1);
  });

  test("keeps the operator's own settings entries", () => {
    const home = makeHome(syncedRoot);
    write(
      join(home, '.claude', 'settings.local.json'),
      JSON.stringify({
        env: { AGENT_CODE_PATH: '/code/acme' },
        permissions: { allow: ['Bash(ls)'], additionalDirectories: ['/code'] },
        sandbox: { filesystem: { allowWrite: ['/code'], denyRead: ['.kevin/secrets'] } }
      })
    );
    setupHistory(home, {}, historyEnv);
    const gitDir = join(userHome, '.local', 'state', 'agent-kevin', 'Documents-Ada.git');
    expect(settingsOf(home)).toEqual({
      env: { AGENT_CODE_PATH: '/code/acme', AGENT_HOME_GIT_DIR: gitDir },
      permissions: { allow: ['Bash(ls)'], additionalDirectories: ['/code', gitDir] },
      sandbox: { filesystem: { allowWrite: ['/code', gitDir], denyRead: ['.kevin/secrets'] } }
    });
  });

  test('sets a repo-local identity when the machine has none', () => {
    const globalConfig = join(root, 'empty-gitconfig');
    writeFileSync(globalConfig, '');
    const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM };
    process.env.GIT_CONFIG_GLOBAL = globalConfig;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    try {
      const home = makeHome(join(root, 'local'));
      expect(setupHistory(home, { name: 'Ada Lovelace' }, historyEnv).outcome).toBe('turned-on');
      expect(git(home, 'config', '--local', 'user.name')).toBe('Ada Lovelace');
      expect(git(home, 'config', '--local', 'user.email')).toBe('ada@localhost');
      expect(readFileSync(globalConfig, 'utf-8')).toBe('');
    } finally {
      process.env.GIT_CONFIG_GLOBAL = saved.global;
      process.env.GIT_CONFIG_NOSYSTEM = saved.nosystem;
      if (saved.global === undefined) {
        delete process.env.GIT_CONFIG_GLOBAL;
      }
      if (saved.nosystem === undefined) {
        delete process.env.GIT_CONFIG_NOSYSTEM;
      }
    }
  });

  test('an old .gitignore gains the template rules before the first snapshot', () => {
    const home = makeHome(join(root, 'local'));
    write(join(home, '.gitignore'), '.kevin/\nmy-notes.tmp\n');
    expect(setupHistory(home, {}, historyEnv).outcome).toBe('turned-on');
    expect(git(home, 'ls-files').split('\n')).toContain('.kevin/knowledge.json');
    expect(() => git(home, 'check-ignore', '-q', '.claude/settings.local.json.123.abc.tmp')).not.toThrow();
  });

  test('a .gitignore that lets local settings in stops setup before any snapshot', () => {
    const home = makeHome(join(root, 'local'));
    write(join(home, '.gitignore'), '.claude/settings.local.json*\n!.claude/settings.local.json\n');
    write(join(home, '.claude', 'settings.local.json'), '{}\n');
    const result = setupHistory(home, {}, historyEnv);
    expect(result.outcome).toBe('refused');
    expect(result.message).toContain('.claude/settings.local.json');
    expect(() => git(home, 'rev-parse', '--verify', '-q', 'HEAD')).toThrow();
  });
});

describe('recovering from interruptions, moves and deletions', () => {
  test('a setup interrupted before the history was stamped finishes on the next run', () => {
    const home = makeHome(join(root, 'local'));
    git(home, 'init', '-q', '-b', 'main');
    expect(historyStatus(home, historyEnv).state).toBe('on');
    expect(setupHistory(home, {}, historyEnv).outcome).toBe('turned-on');
    expect(git(home, 'config', '--get', 'agent.home')).toBe(home);
  });

  test('renaming a home with history kept inside it keeps history working', () => {
    const before = makeHome(join(root, 'local'));
    setupHistory(before, {}, historyEnv);
    const after = join(root, 'local', 'Renamed');
    renameSync(before, after);
    expect(historyStatus(after, historyEnv).state).toBe('on');
    expect(setupHistory(after, {}, historyEnv).outcome).toBe('already-on');
    expect(git(after, 'config', '--get', 'agent.home')).toBe(after);
  });

  test('moving a synced home keeps its history, and the link still repairs', () => {
    const before = makeHome(syncedRoot);
    const { status } = setupHistory(before, {}, historyEnv);
    const after = join(syncedRoot, 'Moved');
    renameSync(before, after);
    expect(historyStatus(after, historyEnv)).toMatchObject({ state: 'on', gitDir: status.gitDir });
    rmSync(join(after, '.git'));
    expect(restorePointer(after)).toBe(true);
    expect(historyStatus(after, historyEnv).state).toBe('on');
  });

  test('a history folder deleted by hand can be started over, only when asked', () => {
    const home = makeHome(syncedRoot);
    const first = setupHistory(home, {}, historyEnv);
    rmSync(first.status.gitDir ?? '', { recursive: true });
    rmSync(join(home, '.git'));
    expect(historyStatus(home, historyEnv).state).toBe('history-missing');
    expect(setupHistory(home, {}, historyEnv).outcome).toBe('refused');
    const fresh = setupHistory(home, { startOver: true }, historyEnv);
    expect(fresh.outcome).toBe('turned-on');
    expect(settingsOf(home).env?.AGENT_HOME_GIT_DIR).toBe(fresh.status.gitDir ?? '');
  });
});

describe('pre-release review fixes', () => {
  test('a link left pointing at a deleted history folder can be started over, not stuck', () => {
    const home = makeHome(syncedRoot);
    const first = setupHistory(home, {}, historyEnv);
    rmSync(first.status.gitDir ?? '', { recursive: true });
    expect(existsSync(join(home, '.git'))).toBe(true);
    expect(historyStatus(home, historyEnv).state).toBe('history-missing');
    expect(setupHistory(home, {}, historyEnv).outcome).toBe('refused');
    const fresh = setupHistory(home, { startOver: true }, historyEnv);
    expect(fresh.outcome).toBe('turned-on');
    expect(fresh.status.state).toBe('on');
    expect(commitCount(home)).toBe(1);
  });

  test('a stale index lock from a crashed first snapshot does not block setup forever', () => {
    const home = makeHome(join(root, 'local'));
    git(home, 'init', '-q');
    git(home, 'config', 'agent.home', home);
    const lock = join(home, '.git', 'index.lock');
    writeFileSync(lock, '');
    const old = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(lock, old, old);
    expect(setupHistory(home, {}, historyEnv).outcome).toBe('turned-on');
  });

  test('a home that starts syncing after setup is flagged, and setup moves its history out', () => {
    const home = makeHome(join(root, 'local'));
    setupHistory(home, {}, historyEnv);
    const nowSynced = {
      ...historyEnv,
      syncedBy: (path: string) => (path.startsWith(join(root, 'local')) ? 'iCloud Drive' : null)
    };
    const status = historyStatus(home, nowSynced);
    expect(status).toMatchObject({ state: 'on', layout: 'in-place', homeSyncedBy: 'iCloud Drive' });
    const moved = setupHistory(home, {}, nowSynced);
    expect(moved.outcome).toBe('moved');
    expect(moved.status.layout).toBe('split');
    expect(commitCount(home)).toBe(1);
    expect(settingsOf(home).env?.AGENT_HOME_GIT_DIR).toBe(moved.status.gitDir ?? '');
  });

  test('a moved synced home is re-stamped, so a folder later made at the old path cannot claim it', () => {
    const before = makeHome(syncedRoot);
    setupHistory(before, {}, historyEnv);
    const after = join(syncedRoot, 'Moved');
    renameSync(before, after);
    followMove(after);
    makeHome(syncedRoot);
    expect(historyStatus(after, historyEnv).state).toBe('on');
    expect(git(after, 'config', '--get', 'agent.home')).toBe(after);
  });

  test('history is created on the main line whatever the git version defaults to', () => {
    const home = makeHome(join(root, 'local'));
    setupHistory(home, {}, historyEnv);
    expect(git(home, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
  });
});

describe('leftovers from the pre-release review', () => {
  test('losing both the link and the record reattaches the existing history instead of starting a second', () => {
    const home = makeHome(syncedRoot);
    const first = setupHistory(home, {}, historyEnv);
    rmSync(join(home, '.git'));
    rmSync(join(home, '.claude', 'settings.local.json'));
    expect(historyStatus(home, historyEnv).historyFolder).toBe(first.status.gitDir);
    const again = setupHistory(home, {}, historyEnv);
    expect(again.outcome).toBe('already-on');
    expect(again.status.gitDir).toBe(first.status.gitDir);
    expect(settingsOf(home).env?.AGENT_HOME_GIT_DIR).toBe(first.status.gitDir ?? '');
  });

  test('a history moved and stamped by hand is status on with no record, and setup records it with both grants', () => {
    const home = makeHome(syncedRoot);
    const handMoved = join(root, 'hand-moved.git');
    git(home, 'init', '-q', '-b', 'main', '--separate-git-dir', handMoved);
    git(home, '-c', 'user.name=Ada', '-c', 'user.email=ada@localhost', 'commit', '-q', '--allow-empty', '-m', 'mine');
    git(home, 'config', 'agent.home', home);
    expect(historyStatus(home, historyEnv)).toMatchObject({ state: 'on', layout: 'split', gitDir: handMoved });
    expect(existsSync(join(home, '.claude', 'settings.local.json'))).toBe(false);
    const adopted = setupHistory(home, {}, historyEnv);
    expect(adopted).toMatchObject({ outcome: 'already-on', settingsChanged: true });
    expect(commitCount(home)).toBe(1);
    const settings = settingsOf(home);
    expect(settings.env?.AGENT_HOME_GIT_DIR).toBe(handMoved);
    expect(settings.permissions?.additionalDirectories).toContain(handMoved);
    expect(settings.sandbox?.filesystem?.allowWrite).toContain(handMoved);
    expect(setupHistory(home, {}, historyEnv).settingsChanged).toBe(false);
  });

  test('a symlinked settings file stays a symlink, and its target gets the record', () => {
    const home = makeHome(syncedRoot);
    const real = join(root, 'dotfiles', 'settings.local.json');
    write(real, JSON.stringify({ env: { AGENT_CODE_PATH: '/code' } }));
    mkdirSync(join(home, '.claude'), { recursive: true });
    symlinkSync(real, join(home, '.claude', 'settings.local.json'));
    setupHistory(home, {}, historyEnv);
    expect(lstatSync(join(home, '.claude', 'settings.local.json')).isSymbolicLink()).toBe(true);
    expect(JSON.parse(readFileSync(real, 'utf-8')).env.AGENT_CODE_PATH).toBe('/code');
    expect(JSON.parse(readFileSync(real, 'utf-8')).env.AGENT_HOME_GIT_DIR).toContain('Documents-Ada.git');
  });
});

describe('git tools that open the history folder itself', () => {
  const toolView = (gitDir: string): string =>
    execFileSync('git', ['--git-dir', gitDir, 'status', '--porcelain'], {
      cwd: dirname(gitDir),
      encoding: 'utf8'
    }).trim();

  test('a split history names the home as its working copy, so it opens clean from either side', () => {
    const home = makeHome(syncedRoot);
    const gitDir = setupHistory(home, {}, historyEnv).status.gitDir ?? '';
    expect(git(home, 'config', '--get', 'core.worktree')).toBe(home);
    expect(toolView(gitDir)).toBe('');
  });

  test('a renamed home gets its working copy back at the next session start', () => {
    const before = makeHome(syncedRoot);
    setupHistory(before, {}, historyEnv);
    const after = join(syncedRoot, 'Moved');
    renameSync(before, after);
    followMove(after);
    expect(git(after, 'config', '--get', 'core.worktree')).toBe(after);
    expect(git(after, 'status', '--porcelain')).toBe('');
  });

  test('a split history made before the working copy was recorded gets it at the next session start', () => {
    const home = makeHome(syncedRoot);
    const gitDir = setupHistory(home, {}, historyEnv).status.gitDir ?? '';
    git(home, 'config', '--unset', 'core.worktree');
    followMove(home);
    expect(toolView(gitDir)).toBe('');
  });

  test('history kept inside the home needs no recorded working copy', () => {
    const home = makeHome(join(root, 'local'));
    setupHistory(home, {}, historyEnv);
    followMove(home);
    expect(() => git(home, 'config', '--get', 'core.worktree')).toThrow();
  });
});

describe('history set up some other way is left alone', () => {
  test('a home with a remote', () => {
    const home = makeHome(join(root, 'local'));
    git(home, 'init', '-q', '-b', 'main');
    git(home, 'remote', 'add', 'origin', 'https://example.com/acme.git');
    expect(setupHistory(home, {}, historyEnv).outcome).toBe('refused');
    expect(historyStatus(home, historyEnv).state).toBe('managed-by-you');
    expect(git(home, 'remote')).toBe('origin');
  });

  test('a home inside another project', () => {
    const project = join(root, 'project');
    mkdirSync(project);
    git(project, 'init', '-q');
    const home = makeHome(project);
    expect(historyStatus(home, historyEnv).state).toBe('managed-by-you');
    expect(setupHistory(home, {}, historyEnv).outcome).toBe('refused');
  });

  test('a split history made by hand, with snapshots of its own', () => {
    const home = makeHome(syncedRoot);
    const handMade = join(root, 'hand-made.git');
    git(home, 'init', '-q', '-b', 'main', '--separate-git-dir', handMade);
    git(home, '-c', 'user.name=Ada', '-c', 'user.email=ada@localhost', 'commit', '-q', '--allow-empty', '-m', 'mine');
    expect(historyStatus(home, historyEnv).state).toBe('managed-by-you');
    expect(setupHistory(home, {}, historyEnv).outcome).toBe('refused');
    expect(existsSync(join(handMade, 'HEAD'))).toBe(true);
  });

  test("a copied home never claims or repairs the original's history", () => {
    const original = makeHome(syncedRoot);
    const { status } = setupHistory(original, {}, historyEnv);
    const copy = makeHome(join(syncedRoot, 'copies'));
    write(
      join(copy, '.claude', 'settings.local.json'),
      readFileSync(join(original, '.claude', 'settings.local.json'), 'utf-8')
    );
    expect(restorePointer(copy)).toBe(false);
    expect(historyStatus(copy, historyEnv).state).toBe('history-missing');
    writeFileSync(join(copy, '.git'), `gitdir: ${status.gitDir}\n`);
    expect(historyStatus(copy, historyEnv).state).toBe('managed-by-you');
    expect(setupHistory(copy, {}, historyEnv).outcome).toBe('refused');
  });
});

describe('link repair and platform', () => {
  // Creating a symlink on Windows needs admin rights or Developer Mode.
  test.skipIf(process.platform === 'win32')(
    'restores a deleted link from the recorded location, and never writes through a symlink',
    () => {
      const home = makeHome(syncedRoot);
      setupHistory(home, {}, historyEnv);
      rmSync(join(home, '.git'));
      expect(historyStatus(home, historyEnv).state).toBe('pointer-missing');
      expect(restorePointer(home)).toBe(true);
      expect(historyStatus(home, historyEnv).state).toBe('on');
      rmSync(join(home, '.git'));
      const outside = join(root, 'outside-target');
      symlinkSync(outside, join(home, '.git'));
      expect(restorePointer(home)).toBe(false);
      expect(existsSync(outside)).toBe(false);
    }
  );

  test('never invents a history folder that is gone', () => {
    const home = makeHome(syncedRoot);
    const { status } = setupHistory(home, {}, historyEnv);
    rmSync(join(home, '.git'));
    rmSync(status.gitDir ?? '', { recursive: true });
    expect(restorePointer(home)).toBe(false);
    expect(historyStatus(home, historyEnv).state).toBe('history-missing');
  });

  test('on Windows, a OneDrive home keeps its history in the local app data folder', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    const localAppData = process.env.LOCALAPPDATA;
    const oneDrive = { ...historyEnv, syncedBy: (path: string) => (path.startsWith(syncedRoot) ? 'OneDrive' : null) };
    const home = makeHome(syncedRoot);
    process.env.LOCALAPPDATA = join(userHome, 'AppData', 'Local');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      expect(historyStatus(home, oneDrive)).toMatchObject({
        state: 'off',
        homeSyncedBy: 'OneDrive',
        historyFolder: join(userHome, 'AppData', 'Local', 'agent-kevin', 'Documents-Ada.git')
      });
    } finally {
      if (platform) {
        Object.defineProperty(process, 'platform', platform);
      }
      if (localAppData === undefined) {
        delete process.env.LOCALAPPDATA;
      } else {
        process.env.LOCALAPPDATA = localAppData;
      }
    }
  });
});
