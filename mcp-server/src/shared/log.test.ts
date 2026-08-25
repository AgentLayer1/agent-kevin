import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { HOME_MARKER_FILES, RUNTIME_DIR_DEFAULT, agentKeyName } from '@/shared/naming';

/**
 * The logger must never scaffold anything, and file output only engages for a
 * home carrying a HOME_MARKER_FILES state file.
 *
 * The marker is what every guard reads, and the logger runs on every
 * invocation — including ones a guard has already refused. Before the marker
 * moved off the bare data dir, the logger's own `.kevin/logs/` write in a
 * cwd-fallback tree was enough to make the refusal itself let the next
 * attempt succeed.
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

  test('writes into a marked home data dir', async () => {
    await withHome(
      (home) => {
        mkdirSync(resolve(home, RUNTIME_DIR_DEFAULT), { recursive: true });
        writeFileSync(resolve(home, RUNTIME_DIR_DEFAULT, HOME_MARKER_FILES[0]), '{}\n');
      },
      async (home) => {
        const { log } = await import(`@/shared/log?marker=${Date.now()}`);
        log.info('should land in the log file');
        expect(existsSync(resolve(home, RUNTIME_DIR_DEFAULT, 'logs', 'app.log'))).toBe(true);
      }
    );
  });

  // The planted-dir regression: a bare data dir (only runtime artifacts, no
  // marker file) is what the pre-guard logger left in worktrees. It must not
  // re-arm file logging there.
  test('refuses a data dir that carries no home marker', async () => {
    await withHome(
      (home) => mkdirSync(resolve(home, RUNTIME_DIR_DEFAULT, 'logs'), { recursive: true }),
      async (home) => {
        const { log } = await import(`@/shared/log?planted=${Date.now()}`);
        log.info('should stay on stderr only');
        expect(existsSync(resolve(home, RUNTIME_DIR_DEFAULT, 'logs', 'app.log'))).toBe(false);
      }
    );
  });
});
