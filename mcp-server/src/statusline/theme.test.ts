import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Theme } from './render';
import { claudeTheme } from './theme';

const dirs: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'statusline-theme-'));
  dirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const writeJson = (path: string, json: object): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(json));
};

describe('claudeTheme', () => {
  test('every built-in preset reads as light or dark; auto, no theme or a broken file stay undecided', () => {
    const configDir = scratch();
    const themeOf = (theme: string): Theme | undefined => {
      writeJson(join(configDir, 'settings.json'), { theme });
      return claudeTheme(undefined, configDir);
    };
    expect(['light', 'light-daltonized', 'light-ansi', 'dark', 'dark-daltonized', 'dark-ansi'].map(themeOf)).toEqual([
      'light',
      'light',
      'light',
      'dark',
      'dark',
      'dark'
    ]);
    expect(themeOf('auto')).toBeUndefined();
    writeFileSync(join(configDir, 'settings.json'), '{not json');
    expect(claudeTheme(undefined, configDir)).toBeUndefined();
    expect(claudeTheme(scratch(), scratch())).toBeUndefined();
  });

  test('follows Claude Code precedence: local, then project, then user', () => {
    const projectDir = scratch();
    const configDir = scratch();
    writeJson(join(configDir, 'settings.json'), { theme: 'dark' });
    expect(claudeTheme(projectDir, configDir)).toBe('dark');
    writeJson(join(projectDir, '.claude', 'settings.json'), { theme: 'light' });
    expect(claudeTheme(projectDir, configDir)).toBe('light');
    writeJson(join(projectDir, '.claude', 'settings.local.json'), { theme: 'auto' });
    expect(claudeTheme(projectDir, configDir)).toBeUndefined();
  });

  test('a custom theme reads as its base preset, which defaults to dark', () => {
    const configDir = scratch();
    writeJson(join(configDir, 'settings.json'), { theme: 'custom:latte' });
    writeJson(join(configDir, 'themes', 'latte.json'), { base: 'light-ansi', overrides: {} });
    expect(claudeTheme(undefined, configDir)).toBe('light');
    writeJson(join(configDir, 'themes', 'latte.json'), { overrides: {} });
    expect(claudeTheme(undefined, configDir)).toBe('dark');
  });
});
