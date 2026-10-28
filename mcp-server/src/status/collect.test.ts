import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { HOME_MARKER_FILES, RUNTIME_DIR, pluginName } from '@/shared/naming';
import { operatorGithubLogin } from './collect';

const withUserMd = <T>(body: string, fn: () => T): T => {
  const home = mkdtempSync(resolve(tmpdir(), 'collect-test-'));
  mkdirSync(resolve(home, RUNTIME_DIR), { recursive: true });
  writeFileSync(resolve(home, RUNTIME_DIR, HOME_MARKER_FILES[0]), `${JSON.stringify({ plugin: pluginName() })}\n`);
  writeFileSync(resolve(home, 'USER.md'), body);
  const priorHome = process.env.AGENT_HOME;
  process.env.AGENT_HOME = home;
  try {
    return fn();
  } finally {
    process.env.AGENT_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
  }
};

describe('operatorGithubLogin', () => {
  test('a note after the login is not part of it', () => {
    const md = "- **GitHub login:** octo-cat (the PR playbooks use it to tell my PRs from teammates')\n";
    expect(withUserMd(md, operatorGithubLogin)).toBe('octo-cat');
  });

  test('backticks and a leading @ are dropped', () => {
    expect(withUserMd('- **GitHub login:** `@octo-cat`\n', operatorGithubLogin)).toBe('octo-cat');
  });

  test('no field reads as empty', () => {
    expect(withUserMd('# About Ada\n', operatorGithubLogin)).toBe('');
  });
});
