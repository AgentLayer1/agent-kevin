/**
 * Browser launch diagnostics and cross-platform context acquisition shared by
 * every chromium launch path (the browser_* capture tools and the
 * browser-flows harness).
 *
 * Linux/WSL2: the chromium *binary* downloads fine, but it links against
 * system shared libs (libnss3, libgbm1, libasound2, …) that aren't installed
 * on a fresh distro and don't ship with the OS the way they do on macOS. The
 * binary-exists guard passes, then launch() fails at runtime with a missing-.so
 * error. `playwright install-deps` (apt) is the fix, but it needs sudo so it
 * can't live in postinstall — surface the exact command instead of leaking a
 * raw stack trace.
 *
 * Native Windows: bun never delivers the extra stdio fds Playwright's pipe
 * transport rides on (oven-sh/bun#27977), so chromium.launch() hangs. On win32
 * `acquireContext` spawns chromium on a TCP debug port and attaches over CDP
 * instead. The CDP WebSocket needs the npm `ws` client under bun
 * (oven-sh/bun#9911) — wired by patches/playwright-core@<version>.patch.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface PageLike {
  goto: (url: string, opts?: { waitUntil?: 'load' | 'networkidle' | 'domcontentloaded' }) => Promise<unknown>;
  setContent: (html: string, opts?: { waitUntil?: 'load' | 'networkidle' | 'domcontentloaded' }) => Promise<unknown>;
  content: () => Promise<string>;
  addStyleTag: (opts: { content: string }) => Promise<unknown>;
  screenshot: (opts?: { fullPage?: boolean; path?: string }) => Promise<Buffer>;
  pdf: (opts?: { path?: string; format?: string }) => Promise<Buffer>;
  evaluate: (fn: (px: number) => void, arg: number) => Promise<void>;
  video: () => { saveAs: (path: string) => Promise<void>; delete: () => Promise<void> } | null;
  waitForTimeout: (ms: number) => Promise<void>;
  waitForFunction: (
    pageFunction: () => boolean,
    options?: { timeout?: number; polling?: number | 'raf' }
  ) => Promise<unknown>;
}

export interface BrowserContextLike {
  newPage: () => Promise<PageLike>;
  close: () => Promise<void>;
}

export interface BrowserLike {
  newContext: (options?: {
    recordVideo?: { dir: string; size?: { width: number; height: number } };
    viewport?: { width: number; height: number } | null;
  }) => Promise<BrowserContextLike>;
  close: () => Promise<void>;
}

export interface ChromiumLike {
  executablePath: () => string;
  launch: (options?: { headless?: boolean }) => Promise<BrowserLike>;
  connectOverCDP: (endpoint: string) => Promise<BrowserLike>;
}

export interface AcquiredContext {
  context: BrowserContextLike;
  close: () => Promise<void>;
}

const MISSING_DEPS_RE = /shared librar|missing dependencies|libnss|libgbm|libatk|libasound/i;

/** Wrap any chromium launch (`launch` or `launchPersistentContext`) so a
 *  missing-system-libs failure on Linux/WSL2 rethrows with the install-deps fix. */
export async function withBrowserLaunch<T>(launchFn: () => Promise<T>): Promise<T> {
  try {
    return await launchFn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (process.platform === 'linux' && MISSING_DEPS_RE.test(message)) {
      throw new Error(
        'Chromium launched but is missing system libraries (libnss3, libgbm1, libasound2, …). ' +
          'On Linux/WSL2 these are not installed by default. Run once from a normal terminal:\n' +
          '  sudo $CLAUDE_PLUGIN_ROOT/mcp-server/node_modules/.bin/playwright install-deps chromium\n' +
          `Original error: ${message}`
      );
    }
    throw err;
  }
}

const CDP_PORT_TIMEOUT_MS = 30_000;

const readDevToolsPort = async (proc: Bun.Subprocess, profileDir: string): Promise<number> => {
  const portFile = join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + CDP_PORT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`chromium exited (code ${proc.exitCode}) before opening its CDP port.`);
    }
    if (existsSync(portFile)) {
      const port = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
      if (port > 0) {
        return port;
      }
    }
    await Bun.sleep(100);
  }
  throw new Error(`chromium did not open a CDP port within ${CDP_PORT_TIMEOUT_MS}ms.`);
};

export interface CdpChromium<B extends BrowserLike> {
  browser: B;
  /** Resolves when chromium exits — on its own (graceful CDP quit) or via `killTree`. */
  exited: Promise<number>;
  /** Force-kill the chromium process tree; a CDP-attached `browser.close()` only disconnects. */
  killTree: () => Promise<void>;
}

/**
 * Spawn chromium on an OS-assigned CDP port and attach over it — the win32 seam bun forces on us
 * (it can't drive Playwright's pipe transport, oven-sh/bun#27977). The caller owns the profile dir
 * and the close policy; this only spawns, attaches, and hands back a process-tree killer.
 */
export const spawnChromiumCdp = async <B extends BrowserLike>(
  chromium: Omit<ChromiumLike, 'connectOverCDP'> & { connectOverCDP: (endpoint: string) => Promise<B> },
  { profileDir, headless, extraArgs = [] }: { profileDir: string; headless: boolean; extraArgs?: readonly string[] }
): Promise<CdpChromium<B>> => {
  // A reused (persistent) profile can hold a stale port file from a prior run; drop it so we only
  // read the port the fresh chromium writes (a dead port → connectOverCDP ECONNREFUSED).
  rmSync(join(profileDir, 'DevToolsActivePort'), { force: true });
  const proc = Bun.spawn(
    [
      chromium.executablePath(),
      ...(headless ? ['--headless'] : []),
      // port 0 = OS-assigned; chromium writes it to <profileDir>/DevToolsActivePort
      '--remote-debugging-port=0',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      ...extraArgs
    ],
    { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }
  );

  const killTree = async () => {
    const killer = Bun.spawn(['taskkill', '/PID', String(proc.pid), '/T', '/F'], { stdout: 'ignore', stderr: 'ignore' });
    await killer.exited;
    await proc.exited;
  };

  try {
    const port = await readDevToolsPort(proc, profileDir);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch((error: unknown) => {
      throw new Error(
        'connectOverCDP failed under bun on Windows — the playwright-core ws patch is likely missing or orphaned ' +
          '(oven-sh/bun#9911). Check that `patchedDependencies` in mcp-server/package.json matches the installed ' +
          `playwright-core version, then re-run \`bun install\`. Original error: ${
            error instanceof Error ? error.message : String(error)
          }`
      );
    });
    return { browser, exited: proc.exited, killTree };
  } catch (error) {
    await killTree();
    throw error;
  }
};

const acquireViaCdp = async (chromium: ChromiumLike): Promise<AcquiredContext> => {
  const profileDir = mkdtempSync(join(tmpdir(), 'kevin-cdp-'));
  const removeProfile = () => {
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // a straggler crashpad handler can hold the dir for a beat; harmless
    }
  };

  let handle: CdpChromium<BrowserLike>;
  try {
    handle = await spawnChromiumCdp(chromium, { profileDir, headless: true, extraArgs: ['--hide-scrollbars'] });
  } catch (error) {
    removeProfile();
    throw error;
  }

  const { browser, killTree } = handle;
  try {
    const context = await browser.newContext();
    return {
      context,
      // A CDP-attached browser.close() only disconnects — kill the chromium tree, then the profile.
      close: async () => {
        await browser.close().catch(() => {});
        await killTree();
        removeProfile();
      }
    };
  } catch (error) {
    await killTree();
    removeProfile();
    throw error;
  }
};

/** Acquire a browser context cross-platform: CDP attach on win32 (bun can't
 *  drive Playwright's pipe transport there — oven-sh/bun#27977), in-process
 *  launch elsewhere. */
export const acquireContext = async (chromium: ChromiumLike): Promise<AcquiredContext> => {
  if (process.platform === 'win32') {
    return acquireViaCdp(chromium);
  }
  const browser = await withBrowserLaunch(() => chromium.launch({ headless: true }));
  try {
    const context = await browser.newContext();
    return { context, close: () => browser.close() };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
};
