import { describe, expect, test } from 'bun:test';
import { asks, mergeSettings } from '@/home/settings-scope';

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

describe('asks', () => {
  test('holds only for a rule in permissions.ask', () => {
    expect(asks({ permissions: { ask: ['Bash(git push *)', 'mcp__acme__send'] } }, 'mcp__acme__send')).toBe(true);
    expect(asks({ permissions: { allow: ['mcp__acme__send'], ask: [] } }, 'mcp__acme__send')).toBe(false);
    expect(asks({}, 'mcp__acme__send')).toBe(false);
  });
});
