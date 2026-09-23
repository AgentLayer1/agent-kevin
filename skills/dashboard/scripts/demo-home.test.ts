import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, 'demo-home.ts');
const outDir = mkdtempSync(join(tmpdir(), 'demo-home-test-'));
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

describe('demo-home', () => {
  test.skipIf(process.platform === 'win32')('renders a green, fully populated demo with no machine or temp paths left in it', () => {
    const out = join(outDir, 'dashboard.html');
    const proc = spawnSync(process.execPath, [SCRIPT, '--out', out], { timeout: 120_000 });
    expect(proc.stderr.toString()).toBe('');
    expect(proc.status).toBe(0);

    const html = readFileSync(out, 'utf-8');
    expect(html).toContain('all nominal');
    expect(html).toContain('Billing dual-write reconciliation report');
    expect(html).toContain('data-stale-hours="876000"');
    expect(html).toContain('/home/alex/agent-acme');
    expect(html.includes(homedir())).toBe(false);
    expect(html.includes(tmpdir())).toBe(false);
    expect(html.includes(encodeURIComponent(tmpdir()))).toBe(false);
  }, 180_000);
});
