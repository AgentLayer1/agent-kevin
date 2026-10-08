import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { commandBinPath, statusLineDrift, statusLineSetting } from './setting';
import { AGENT_SLUG, PLUGIN_NAME } from '@/config';

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

const BIN = resolve(`/opt/${AGENT_SLUG}/bin/${AGENT_SLUG}`);

describe('statusLineSetting', () => {
  test('runs the given script with bun, double-quoted, forward slashes only', () => {
    expect(statusLineSetting(BIN)).toEqual({
      type: 'command',
      command: `bun "/opt/${AGENT_SLUG}/bin/${AGENT_SLUG}" statusline`
    });
    expect(statusLineSetting(`C:\\Users\\ada\\${AGENT_SLUG}\\bin\\${AGENT_SLUG}`).command).toBe(
      `bun "C:/Users/ada/${AGENT_SLUG}/bin/${AGENT_SLUG}" statusline`
    );
  });

  test('refuses a path a shell would expand inside the quotes', () => {
    expect(() => statusLineSetting(`/opt/$HOME/bin/${AGENT_SLUG}`)).toThrow('may not contain');
  });
});

describe('commandBinPath', () => {
  test('reads our own command back, quoted or not, and ignores anything else', () => {
    expect(commandBinPath(`bun "/opt/${AGENT_SLUG}/bin/${AGENT_SLUG}" statusline`, `${AGENT_SLUG}`)).toBe(
      `/opt/${AGENT_SLUG}/bin/${AGENT_SLUG}`
    );
    expect(commandBinPath(`bun /opt/${AGENT_SLUG}/bin/${AGENT_SLUG} statusline --subagent`, `${AGENT_SLUG}`)).toBe(
      `/opt/${AGENT_SLUG}/bin/${AGENT_SLUG}`
    );
    expect(commandBinPath('bun "/opt/scout/bin/scout" statusline', `${AGENT_SLUG}`)).toBeUndefined();
    expect(commandBinPath('~/.claude/statusline.sh', `${AGENT_SLUG}`)).toBeUndefined();
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
    const stale = settingsFile(
      JSON.stringify({ statusLine: statusLineSetting(`/cache/${PLUGIN_NAME}/0.4.4/bin/${AGENT_SLUG}`) })
    );
    const drift = statusLineDrift(stale, BIN);
    expect(drift).toContain(`/cache/${PLUGIN_NAME}/0.4.4/bin/${AGENT_SLUG}`);
    expect(drift).toContain(`/opt/${AGENT_SLUG}/bin/${AGENT_SLUG}`);
    expect(drift).toContain(`/${PLUGIN_NAME}:upgrade`);
    expect(drift).toContain('.claude/settings.json');
  });

  test('reads the local file first, as Claude Code does', () => {
    const stale = JSON.stringify({ statusLine: statusLineSetting(`/cache/${PLUGIN_NAME}/0.4.4/bin/${AGENT_SLUG}`) });
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
