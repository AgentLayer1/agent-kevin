import { describe, expect, test } from 'bun:test';
import { mergeSettings } from '@/home/settings-scope';

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
