import { checkHosts, hostIssues, parseHostVersion, requiredHosts, type HostName } from '@/hosts';
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const runner = (versions: Partial<Record<HostName, string | null>>) => (name: HostName) => versions[name] ?? null;

describe('hosts', () => {
  test('parses the first x.y.z from either CLI, prerelease included', () => {
    expect(parseHostVersion('2.1.270 (Claude Code)')).toBe('2.1.270');
    expect(parseHostVersion('codex-cli 0.155.0-alpha.6')).toBe('0.155.0');
    expect(parseHostVersion('command not found')).toBeNull();
  });

  test('an outdated required host fails the report and names the update', () => {
    const report = checkHosts(new Set(['claude']), runner({ claude: '2.1.200 (Claude Code)' }));
    expect(report.ok).toBe(false);
    expect(hostIssues(report)).toEqual([expect.stringContaining("claude 2.1.200 is below the plugin's floor")]);
  });

  test('an absent codex passes when optional and fails when required', () => {
    const versions = runner({ claude: '2.1.270 (Claude Code)' });
    expect(checkHosts(new Set(['claude']), versions).ok).toBe(true);
    expect(hostIssues(checkHosts(new Set(['claude']), versions))).toEqual([]);
    const required = checkHosts(new Set(['claude', 'codex']), versions);
    expect(required.ok).toBe(false);
    expect(hostIssues(required)).toEqual(['codex is not on PATH, and this home is wired for it']);
  });

  test('an outdated optional host keeps ok but still surfaces as an issue', () => {
    const report = checkHosts(
      new Set(['claude']),
      runner({ claude: '2.1.270 (Claude Code)', codex: 'codex-cli 0.150.0' })
    );
    expect(report.ok).toBe(true);
    expect(hostIssues(report)).toHaveLength(1);
  });

  test('a prerelease above the floor passes', () => {
    const report = checkHosts(
      new Set(['claude', 'codex']),
      runner({ claude: '2.1.271 (Claude Code)', codex: 'codex-cli 0.155.0-alpha.6' })
    );
    expect(report.ok).toBe(true);
  });

  test('codex is required for a wired home or when the caller says so', () => {
    const home = mkdtempSync(join(tmpdir(), 'hosts-'));
    expect([...requiredHosts(home)]).toEqual(['claude']);
    expect([...requiredHosts(home, true)]).toEqual(['claude', 'codex']);
    mkdirSync(join(home, '.codex'));
    writeFileSync(join(home, '.codex', 'hooks.json'), '{}');
    expect([...requiredHosts(home)]).toEqual(['claude', 'codex']);
  });
});
