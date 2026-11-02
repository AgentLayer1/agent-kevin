import { existsSync } from 'node:fs';
import type { BrowserContext, BrowserContextOptions, BrowserType } from 'playwright';
import { log } from './log';

export interface AcquiredContext {
  context: BrowserContext;
  close: () => Promise<void>;
}

/**
 * The playwright chromium, checked for its binary. `PLAYWRIGHT_BROWSERS_PATH=0` is set by whatever
 * launches the server (the Claude manifest, the home's Codex registration) so playwright resolves the
 * browser inside the plugin's own `node_modules/playwright/.local-browsers/`, the postinstall location.
 */
export async function getChromium(): Promise<BrowserType> {
  let chromium: BrowserType;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error(
      'playwright package is not installed. Run `cd $CLAUDE_PLUGIN_ROOT/mcp-server && bun install` from a normal terminal.'
    );
  }
  const binaryPath = chromium.executablePath();
  if (!binaryPath || !existsSync(binaryPath)) {
    throw new Error(
      "Chromium binary is missing — the plugin's postinstall didn't complete. " +
        'Run `cd $CLAUDE_PLUGIN_ROOT/mcp-server && PLAYWRIGHT_BROWSERS_PATH=0 bunx playwright install chromium` from a normal terminal (outside Claude Code) so the download bypasses the sandbox.'
    );
  }
  return chromium;
}

// On a fresh Linux/WSL2 distro chromium's system libs (libnss3, libgbm1, libasound2) are missing; `playwright install-deps`
// fixes it but needs sudo, so postinstall can't run it.
const MISSING_DEPS_RE = /shared librar|missing dependencies|libnss|libgbm|libatk|libasound/i;

// Under bun, chromium's DevTools pipe now and then breaks at startup: chromium exits cleanly and Playwright waits out
// its whole 180s launch timeout. A healthy launch takes seconds, so time out early and launch again; three attempts
// stay inside the host's 120s MCP tool budget.
const LAUNCH_TIMEOUT_MS = 20_000;
const LAUNCH_ATTEMPTS = 3;

const isTimeout = (err: unknown): boolean => err instanceof Error && err.name === 'TimeoutError';

const launchWithRetry = async <T>(launchFn: (timeout: number) => Promise<T>, attempt: number): Promise<T> => {
  try {
    return await launchFn(LAUNCH_TIMEOUT_MS);
  } catch (err) {
    if (!isTimeout(err) || attempt >= LAUNCH_ATTEMPTS) {
      throw err;
    }
    log.warn(`chromium launch timed out (attempt ${attempt}/${LAUNCH_ATTEMPTS}), retrying`);
    return launchWithRetry(launchFn, attempt + 1);
  }
};

/**
 * Wrap any chromium launch (`launch` or `launchPersistentContext`), passing it the launch timeout to use. A timed-out
 * launch is retried, and a missing-system-libs failure on Linux/WSL2 rethrows with the install-deps fix.
 */
export async function withBrowserLaunch<T>(launchFn: (timeout: number) => Promise<T>): Promise<T> {
  try {
    return await launchWithRetry(launchFn, 1);
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

export const acquireContext = async (
  chromium: BrowserType,
  options?: BrowserContextOptions
): Promise<AcquiredContext> => {
  const browser = await withBrowserLaunch((timeout) => chromium.launch({ headless: true, timeout }));
  try {
    const context = await browser.newContext(options);
    return { context, close: () => browser.close() };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
};
