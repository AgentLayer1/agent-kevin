import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dir, '0.6.0.ts');
const GENERATED = `<!doctype html><html><body><main>Focus</main>
<script type="application/json" id="focus-data">{"version":1}</script>
</body></html>
`;

const homes: string[] = [];
const makeHome = (files: Record<string, string> = {}): string => {
  const home = mkdtempSync(join(tmpdir(), 'migrate-060-'));
  homes.push(home);
  Object.entries(files).forEach(([rel, content]) => {
    mkdirSync(resolve(home, rel, '..'), { recursive: true });
    writeFileSync(join(home, rel), content);
  });
  return home;
};
const run = (home: string): { action: string; ok: boolean } => {
  const result = spawnSync('bun', [SCRIPT], {
    env: { ...process.env, KEVIN_HOME: home, AGENT_HOME: home },
    encoding: 'utf-8'
  });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}');
};

afterAll(() => homes.forEach((home) => rmSync(home, { recursive: true, force: true })));

describe('0.6.0 home focus page retirement', () => {
  test('removes a generated focus page, then is a no-op', () => {
    const home = makeHome({ 'focus.html': GENERATED });
    expect(run(home)).toMatchObject({ ok: true, action: 'removed' });
    expect(existsSync(join(home, 'focus.html'))).toBe(false);
    expect(run(home)).toMatchObject({ ok: true, action: 'absent' });
  });

  test('keeps a hand-made focus.html', () => {
    const home = makeHome({ 'focus.html': '<html><body>my notes</body></html>\n' });
    expect(run(home)).toMatchObject({ ok: true, action: 'kept-hand-made' });
    expect(readFileSync(join(home, 'focus.html'), 'utf-8')).toContain('my notes');
  });

  test('leaves project focus pages alone', () => {
    const home = makeHome({ 'focus.html': GENERATED, 'projects/acme/focus.html': GENERATED });
    expect(run(home)).toMatchObject({ action: 'removed' });
    expect(readFileSync(join(home, 'projects/acme/focus.html'), 'utf-8')).toBe(GENERATED);
  });
});
