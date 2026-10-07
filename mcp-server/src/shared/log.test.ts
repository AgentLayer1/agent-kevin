import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { HOME_MARKER_FILES, LEGACY_RUNTIME_DIR, RUNTIME_DIR, agentKeyName, pluginName } from '@/shared/naming';

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
        expect(existsSync(resolve(home, RUNTIME_DIR))).toBe(false);
      }
    );
  });

  test('writes into a marked home data dir', async () => {
    await withHome(
      (home) => {
        mkdirSync(resolve(home, RUNTIME_DIR), { recursive: true });
        writeFileSync(
          resolve(home, RUNTIME_DIR, HOME_MARKER_FILES[0]),
          `${JSON.stringify({ plugin: pluginName() })}\n`
        );
      },
      async (home) => {
        const { log } = await import(`@/shared/log?marker=${Date.now()}`);
        log.info('should land in the log file');
        expect(existsSync(resolve(home, RUNTIME_DIR, 'logs', 'app.log'))).toBe(true);
      }
    );
  });

  test('refuses a data dir recorded for another plugin', async () => {
    await withHome(
      (home) => {
        mkdirSync(resolve(home, RUNTIME_DIR), { recursive: true });
        writeFileSync(resolve(home, RUNTIME_DIR, HOME_MARKER_FILES[0]), JSON.stringify({ plugin: 'agent-other' }));
      },
      async (home) => {
        const { log } = await import(`@/shared/log?otherplugin=${Date.now()}`);
        log.info('should stay on stderr only');
        expect(existsSync(resolve(home, RUNTIME_DIR, 'logs', 'app.log'))).toBe(false);
      }
    );
  });

  // The 0.7.0 upgrade moves the data dir while the server that ran it keeps logging.
  test('follows the data dir when it moves under a running process', async () => {
    await withHome(
      (home) => {
        mkdirSync(resolve(home, LEGACY_RUNTIME_DIR), { recursive: true });
        writeFileSync(resolve(home, LEGACY_RUNTIME_DIR, HOME_MARKER_FILES[0]), '{}\n');
      },
      async (home) => {
        const { log } = await import(`@/shared/log?moved=${Date.now()}`);
        log.info('before the move');
        renameSync(resolve(home, LEGACY_RUNTIME_DIR), resolve(home, RUNTIME_DIR));
        writeFileSync(resolve(home, RUNTIME_DIR, HOME_MARKER_FILES[0]), JSON.stringify({ plugin: pluginName() }));
        log.info('after the move');
        expect(existsSync(resolve(home, LEGACY_RUNTIME_DIR))).toBe(false);
        expect(readFileSync(resolve(home, RUNTIME_DIR, 'logs', 'app.log'), 'utf-8')).toContain('after the move');
      }
    );
  });

  // The planted-dir regression: a bare data dir (only runtime artifacts, no
  // marker file) is what the pre-guard logger left in worktrees. It must not
  // re-arm file logging there.
  test('refuses a data dir that carries no home marker', async () => {
    await withHome(
      (home) => mkdirSync(resolve(home, RUNTIME_DIR, 'logs'), { recursive: true }),
      async (home) => {
        const { log } = await import(`@/shared/log?planted=${Date.now()}`);
        log.info('should stay on stderr only');
        expect(existsSync(resolve(home, RUNTIME_DIR, 'logs', 'app.log'))).toBe(false);
      }
    );
  });
});
