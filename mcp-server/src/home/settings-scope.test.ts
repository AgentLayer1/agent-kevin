import { describe, expect, test } from 'bun:test';
import {
  isMachinePath,
  mergeSettings,
  legacyFolderRoots,
  placeRule,
  splitSettings,
  toRulePath,
  type ScopeContext
} from '@/home/settings-scope';

const none: ScopeContext = { plugin: 'agent-kevin', folderRoots: [] };
const context: ScopeContext = { plugin: 'agent-kevin', folderRoots: ['/Users/ada/notes', 'C:\\Users\\ada\\notes'] };

describe('isMachinePath', () => {
  test('a concrete absolute folder is this machine’s', () => {
    [
      '/Users/ada/code',
      '//Users/ada/notes/**',
      'C:\\Users\\ada\\code',
      'C:/Users/ada/code',
      '//c/Users/ada/**'
    ].forEach((path) => expect(isMachinePath(path)).toBe(true));
  });

  test('home-relative, relative, and root-glob paths match on any machine', () => {
    [
      '~/.cache/uv',
      '~/.ssh/id_*',
      '.kevin/secrets',
      './reports/plans',
      '//**/.kevin/secrets/**',
      '//**/.env',
      '//c/**/.env',
      '/'
    ].forEach((path) => expect(isMachinePath(path)).toBe(false));
  });
});

describe('toRulePath', () => {
  test('gives the double-slash form Read and Edit rules read as absolute', () => {
    expect(toRulePath('/Users/ada/notes/**')).toBe('//Users/ada/notes/**');
    expect(toRulePath('//Users/ada/notes/**')).toBe('//Users/ada/notes/**');
    expect(toRulePath('C:\\Users\\ada\\notes/**')).toBe('//c/Users/ada/notes/**');
    expect(toRulePath('C:/Users/ada/notes')).toBe('//c/Users/ada/notes');
    expect(toRulePath('d:\\work')).toBe('//d/work');
  });

  test('a UNC share and a relative path have no rule form', () => {
    expect(toRulePath('\\\\server\\share\\notes')).toBeNull();
    expect(toRulePath('notes/**')).toBeNull();
  });
});

describe('placeRule', () => {
  test('portable policy stays shared', () => {
    [
      'Read(//**/.kevin/secrets/**)',
      'Read(//**/.env)',
      'Read(~/.ssh/id_*)',
      'Read(//c/**/.env)',
      'Edit(/src/**)',
      'Bash(git log *)',
      'Bash(curl https://example.com/*)',
      'mcp__plugin_agent-kevin_kevin__capture',
      'Skill(agent-kevin:sync)'
    ].forEach((rule) => expect(placeRule(rule, context)).toEqual({ owner: 'shared', rule }));
  });

  test('a rule naming a concrete folder moves as it is', () => {
    expect(placeRule('Read(//Users/ada/notes/**)', none)).toEqual({
      owner: 'local',
      rule: 'Read(//Users/ada/notes/**)'
    });
  });

  test('a custom-folder rule an older init wrote is rewritten to a form that matches', () => {
    expect(placeRule('Read(/Users/ada/notes/**)', context)).toEqual({
      owner: 'local',
      rule: 'Read(//Users/ada/notes/**)'
    });
    expect(placeRule('Write(/Users/ada/notes/**)', context)).toEqual({
      owner: 'local',
      rule: 'Edit(//Users/ada/notes/**)'
    });
    expect(placeRule('Read(C:\\Users\\ada\\notes/**)', context)).toEqual({
      owner: 'local',
      rule: 'Read(//c/Users/ada/notes/**)'
    });
  });

  test('a single-slash rule outside the known roots is project-relative and stays', () => {
    expect(placeRule('Read(/Users/ada/notes/**)', none)).toEqual({
      owner: 'shared',
      rule: 'Read(/Users/ada/notes/**)'
    });
  });

  test('a UNC rule has no working form and stays', () => {
    expect(placeRule('Read(\\\\server\\share/**)', none)).toEqual({
      owner: 'shared',
      rule: 'Read(\\\\server\\share/**)'
    });
  });
});

describe('legacyFolderRoots', () => {
  test('reads the folder roots from either env spelling', () => {
    expect(
      legacyFolderRoots(
        { AGENT_KNOWLEDGE: '/Users/ada/notes/' },
        { KEVIN_REPORTS: '/Volumes/work/reports', AGENT_PROJECTS: '' }
      )
    ).toEqual(['/Users/ada/notes', '/Volumes/work/reports']);
  });
});

describe('splitSettings', () => {
  const statusLine = { type: 'command', command: 'bun "/Users/ada/agent-kevin/bin/kevin" statusline' };
  const shared = {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',
    model: 'opus',
    plansDirectory: './reports/plans',
    statusLine,
    enabledPlugins: { 'agent-kevin@agentdev-kevin': true },
    extraKnownMarketplaces: { 'agentdev-kevin': { source: { source: 'directory', path: '/Users/ada/agent-kevin' } } },
    env: { ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-5-5' },
    permissions: {
      allow: [
        'Bash(git log *)',
        'Read(/Users/ada/notes/**)',
        'Write(/Users/ada/notes/**)',
        'Edit(/Users/ada/notes/**)'
      ],
      deny: ['Read(//**/.kevin/secrets/**)', 'Read(~/.ssh/id_*)'],
      additionalDirectories: ['/Users/ada/Developer']
    },
    sandbox: {
      enabled: true,
      filesystem: { denyRead: ['.kevin/secrets'], allowWrite: ['~/.cache/uv', '/Users/ada/Developer'] },
      excludedCommands: ['xcodebuild *']
    }
  };

  test('moves every machine-owned entry and keeps the policy shared', () => {
    const split = splitSettings(shared, { env: { AGENT_HOME_TIMEZONE: 'Asia/Kuala_Lumpur' } }, context);
    expect(split.shared).toEqual({
      $schema: shared.$schema,
      model: 'opus',
      plansDirectory: './reports/plans',
      env: shared.env,
      permissions: { allow: ['Bash(git log *)'], deny: shared.permissions.deny },
      sandbox: {
        enabled: true,
        filesystem: { denyRead: ['.kevin/secrets'], allowWrite: ['~/.cache/uv'] },
        excludedCommands: ['xcodebuild *']
      }
    });
    expect(split.local).toEqual({
      env: { AGENT_HOME_TIMEZONE: 'Asia/Kuala_Lumpur' },
      statusLine,
      enabledPlugins: shared.enabledPlugins,
      extraKnownMarketplaces: shared.extraKnownMarketplaces,
      permissions: {
        additionalDirectories: ['/Users/ada/Developer'],
        allow: ['Read(//Users/ada/notes/**)', 'Edit(//Users/ada/notes/**)']
      },
      sandbox: { filesystem: { allowWrite: ['/Users/ada/Developer'] } }
    });
    expect(split.moves.find((move) => move.entry === 'Write(/Users/ada/notes/**)')).toEqual({
      key: 'permissions.allow',
      entry: 'Write(/Users/ada/notes/**)',
      rewritten: 'Edit(//Users/ada/notes/**)'
    });
    expect(shared.permissions.allow).toHaveLength(4);
  });

  test("a local value already set wins, and the local file's own entries are kept", () => {
    const local = {
      statusLine: { type: 'command', command: '~/.claude/mine.sh' },
      enabledPlugins: { 'agent-kevin@agentdev-kevin': false },
      permissions: { additionalDirectories: ['/Users/ada/Developer', '/Users/ada/other'] }
    };
    const split = splitSettings(shared, local, context);
    expect(split.local.statusLine).toEqual(local.statusLine);
    expect(split.local.enabledPlugins).toEqual({ 'agent-kevin@agentdev-kevin': false });
    expect((split.local.permissions as { additionalDirectories: string[] }).additionalDirectories).toEqual([
      '/Users/ada/Developer',
      '/Users/ada/other'
    ]);
  });

  test("a team's plugins, a published marketplace and a portable status line stay shared", () => {
    const team = {
      statusLine: { type: 'command', command: '~/.claude/statusline.sh' },
      enabledPlugins: { 'agent-kevin@agentdev-kevin': true, 'skill-creator@claude-plugins-official': true },
      extraKnownMarketplaces: {
        'agentdev-kevin': { source: { source: 'directory', path: '/Users/ada/agent-kevin' } },
        acme: { source: { source: 'github', repo: 'acme/plugins' } }
      }
    };
    const split = splitSettings(team, {}, none);
    expect(split.shared).toEqual({
      statusLine: team.statusLine,
      enabledPlugins: { 'skill-creator@claude-plugins-official': true },
      extraKnownMarketplaces: { acme: team.extraKnownMarketplaces.acme }
    });
    expect(split.local).toEqual({
      enabledPlugins: { 'agent-kevin@agentdev-kevin': true },
      extraKnownMarketplaces: { 'agentdev-kevin': team.extraKnownMarketplaces['agentdev-kevin'] }
    });
  });

  test('a second pass moves nothing', () => {
    const first = splitSettings(shared, {}, context);
    const second = splitSettings(first.shared, first.local, context);
    expect(second.moves).toEqual([]);
    expect(second.shared).toEqual(first.shared);
    expect(second.local).toEqual(first.local);
  });

  test("an operator's own empty list is left alone", () => {
    const split = splitSettings({ permissions: { ask: [], additionalDirectories: ['/code'] } }, {}, none);
    expect(split.shared).toEqual({ permissions: { ask: [] } });
  });

  test('a local key that is not a list refuses the move', () => {
    expect(() => splitSettings(shared, { permissions: { additionalDirectories: '/code' } }, context)).toThrow(
      'not a list'
    );
  });
});

describe('mergeSettings', () => {
  test('combines lists, lets a local scalar win, and replaces the status line and a marketplace entry whole', () => {
    const merged = mergeSettings(
      {
        permissions: { allow: ['a', 'b'] },
        model: 'opus',
        statusLine: { type: 'command', command: 'x', padding: 1 },
        extraKnownMarketplaces: { dev: { source: { source: 'github', repo: 'o/r' }, autoUpdate: true } }
      },
      {
        permissions: { allow: ['b', 'c'] },
        model: 'fable',
        statusLine: { type: 'command', command: 'y' },
        extraKnownMarketplaces: { dev: { source: { source: 'directory', path: '/p' } } }
      }
    );
    expect(merged).toEqual({
      permissions: { allow: ['a', 'b', 'c'] },
      model: 'fable',
      statusLine: { type: 'command', command: 'y' },
      extraKnownMarketplaces: { dev: { source: { source: 'directory', path: '/p' } } }
    });
  });
});
