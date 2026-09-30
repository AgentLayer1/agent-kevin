import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { commandBinPath, statusLineDrift, statusLineSetting } from './setting';

const dirs: string[] = [];
/** A home's `.claude` folder holding each named settings file. */
const claudeDir = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'statusline-setting-'));
  dirs.push(dir);
  Object.entries(files).forEach(([name, content]) => writeFileSync(join(dir, name), content));
  return dir;
};
const settingsFile = (content: string): string => claudeDir({ 'settings.json': content });
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const BIN = resolve('/opt/kevin/bin/kevin');

describe('statusLineSetting', () => {
  test('runs the given script with bun, double-quoted, forward slashes only', () => {
    expect(statusLineSetting(BIN)).toEqual({ type: 'command', command: 'bun "/opt/kevin/bin/kevin" statusline' });
    expect(statusLineSetting('C:\\Users\\ada\\kevin\\bin\\kevin').command).toBe(
      'bun "C:/Users/ada/kevin/bin/kevin" statusline'
    );
  });

  test('refuses a path a shell would expand inside the quotes', () => {
    expect(() => statusLineSetting('/opt/$HOME/bin/kevin')).toThrow('may not contain');
  });
});

describe('commandBinPath', () => {
  test('reads our own command back, quoted or not, and ignores anything else', () => {
    expect(commandBinPath('bun "/opt/kevin/bin/kevin" statusline', 'kevin')).toBe('/opt/kevin/bin/kevin');
    expect(commandBinPath('bun /opt/kevin/bin/kevin statusline --subagent', 'kevin')).toBe('/opt/kevin/bin/kevin');
    expect(commandBinPath('bun "/opt/scout/bin/scout" statusline', 'kevin')).toBeUndefined();
    expect(commandBinPath('~/.claude/statusline.sh', 'kevin')).toBeUndefined();
  });
});

describe('statusLineDrift', () => {
  test('is silent for no file, no entry, an operator-owned command, a current path, or unparsable JSON', () => {
    expect(statusLineDrift('/nonexistent/.claude', BIN)).toBeUndefined();
    expect(statusLineDrift(settingsFile('{}'), BIN)).toBeUndefined();
    expect(
      statusLineDrift(settingsFile('{"statusLine":{"type":"command","command":"~/.claude/statusline.sh"}}'), BIN)
    ).toBeUndefined();
    expect(statusLineDrift(settingsFile(JSON.stringify({ statusLine: statusLineSetting(BIN) })), BIN)).toBeUndefined();
    expect(statusLineDrift(settingsFile('{not json'), BIN)).toBeUndefined();
  });

  test('names both paths when the command pins another checkout', () => {
    const stale = settingsFile(JSON.stringify({ statusLine: statusLineSetting('/cache/agent-kevin/0.4.4/bin/kevin') }));
    const drift = statusLineDrift(stale, BIN);
    expect(drift).toContain('/cache/agent-kevin/0.4.4/bin/kevin');
    expect(drift).toContain('/opt/kevin/bin/kevin');
    expect(drift).toContain('/agent-kevin:upgrade');
    expect(drift).toContain('.claude/settings.json');
  });

  test('reads the local file first, as Claude Code does', () => {
    const stale = JSON.stringify({ statusLine: statusLineSetting('/cache/agent-kevin/0.4.4/bin/kevin') });
    const current = JSON.stringify({ statusLine: statusLineSetting(BIN) });
    expect(statusLineDrift(claudeDir({ 'settings.local.json': current, 'settings.json': stale }), BIN)).toBeUndefined();
    expect(statusLineDrift(claudeDir({ 'settings.local.json': stale, 'settings.json': current }), BIN)).toContain(
      '.claude/settings.local.json'
    );
    expect(statusLineDrift(claudeDir({ 'settings.local.json': '{}', 'settings.json': stale }), BIN)).toContain(
      '.claude/settings.json'
    );
  });
});
