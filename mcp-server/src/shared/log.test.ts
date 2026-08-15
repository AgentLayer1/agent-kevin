import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { RUNTIME_DIR_DEFAULT, agentKeyName } from '@/shared/naming';

/**
 * The logger must never create the data dir.
 *
 * That dir is the sole marker identifying a directory as this agent's home, so
 * a logger that scaffolds it forges what every guard reads — and it runs on
 * every invocation, including ones a guard has already refused. Point
 * `<AGENT>_HOME` at a typo or a sibling agent's home and the refusal itself
 * would make the next attempt succeed.
 *
 * Each case re-imports the module because the resolved log file is cached after
 * the first write.
 */
const withHome = async (setup: (home: string) => void, fn: (home: string) => Promise<void>): Promise<void> => {
  const home = mkdtempSync(resolve(tmpdir(), 'log-test-'));
  setup(home);
  const ownKey = agentKeyName('HOME');
  const priorHome = process.env.AGENT_HOME;
  const priorOwn = process.env[ownKey];
  const priorFile = process.env.AGENT_LOG_FILE;
  process.env.AGENT_HOME = home;
  delete process.env[ownKey];
  delete process.env.AGENT_LOG_FILE;
  try {
    await fn(home);
  } finally {
    if (priorHome === undefined) delete process.env.AGENT_HOME;
    else process.env.AGENT_HOME = priorHome;
    if (priorOwn !== undefined) process.env[ownKey] = priorOwn;
    if (priorFile !== undefined) process.env.AGENT_LOG_FILE = priorFile;
    rmSync(home, { recursive: true, force: true });
  }
};

describe('file logging', () => {
  test('never creates the data dir for a home that lacks one', async () => {
    await withHome(
      () => {},
      async (home) => {
        const { log } = await import(`@/shared/log?nomarker=${Date.now()}`);
        log.info('should not scaffold anything');
        expect(existsSync(resolve(home, RUNTIME_DIR_DEFAULT))).toBe(false);
      }
    );
  });

  test('writes into an existing data dir', async () => {
    await withHome(
      (home) => mkdirSync(resolve(home, RUNTIME_DIR_DEFAULT), { recursive: true }),
      async (home) => {
        const { log } = await import(`@/shared/log?marker=${Date.now()}`);
        log.info('should land in the log file');
        expect(existsSync(resolve(home, RUNTIME_DIR_DEFAULT, 'logs', 'app.log'))).toBe(true);
      }
    );
  });
});
