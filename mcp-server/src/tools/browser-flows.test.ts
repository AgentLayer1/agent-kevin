import { withCallSignal } from '@/shared/call-signal';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { isAlive } from '@/shared/process-group';

const HOME = mkdtempSync(resolve(tmpdir(), 'browser-flows-tool-'));
const PRELOAD_HOME = process.env.AGENT_HOME;
process.env.AGENT_HOME = HOME;

const FLOW_WITH_HANGING_CHILD = `import { writeFileSync } from 'node:fs';
const pidFile = process.argv[process.argv.indexOf('--pidfile') + 1] ?? '';
const child = Bun.spawn(['/bin/sleep', '30']);
writeFileSync(pidFile, String(child.pid));
await child.exited;
`;

let tools: typeof import('@/tools/browser-flows').tools;

beforeAll(async () => {
  mkdirSync(resolve(HOME, 'scripts', 'browser', 'hang'), { recursive: true });
  writeFileSync(resolve(HOME, 'scripts', 'browser', 'hang', 'index.ts'), FLOW_WITH_HANGING_CHILD);
  ({ tools } = await import('@/tools/browser-flows'));
});

afterAll(() => {
  rmSync(HOME, { recursive: true, force: true });
  if (PRELOAD_HOME === undefined) {
    delete process.env.AGENT_HOME;
  } else {
    process.env.AGENT_HOME = PRELOAD_HOME;
  }
});

const until = async (check: () => boolean, timeoutMs = 3_000): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) {
    await Bun.sleep(50);
  }
  return check();
};

describe('browser_flows tool', () => {
  test('cancelling the call stops the flow and every process it started', async () => {
    const pidFile = resolve(HOME, 'child.pid');
    const controller = new AbortController();
    const call = withCallSignal(controller.signal, () => tools[0].handler({ flow: 'hang', params: { pidfile: pidFile } }));

    expect(await until(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8') !== '')).toBe(true);
    const childPid = Number(readFileSync(pidFile, 'utf8'));
    controller.abort();

    expect(await call).toMatchObject({ flow: 'hang', stopped: 'cancel' });
    expect(await until(() => !isAlive(childPid))).toBe(true);
  });
});
