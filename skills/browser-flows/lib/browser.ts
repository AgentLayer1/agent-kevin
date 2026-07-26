import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { BROWSER } from '../../../mcp-server/src/config';
import { spawnChromiumCdp, withBrowserLaunch } from '../../../mcp-server/src/shared/browser-deps';

/**
 * Portable browser harness for the browser-flows skill — no flow-specific coupling. Drives a
 * visible persistent Chrome so the operator can log in by hand when a flow needs it (real session,
 * no API keys); the session is reused on later runs. Paths + tunables come from the shared
 * `BROWSER` config. Artifacts live in the operator's HOME, never the plugin repo: the session
 * profile under the gitignored `.kevin/` runtime dir, screenshots under `reports/captures/`.
 */
export interface Target {
  name: string;
  appUrl: string;
  needsTunnel?: boolean;
  guarded?: boolean;
  /** When set, `ensureLoggedIn` blocks for a manual login; omit for flows that don't need auth.
   *  `homePath` is an authed route; `loginPath` is where an unauthenticated session is redirected. */
  auth?: { loginPath: string; homePath: string };
}

export interface Session {
  context: BrowserContext;
  page: Page;
  shotsDir: string;
  headless: boolean;
}

if (!process.env.KEVIN_HOME) {
  throw new Error('KEVIN_HOME is not set — run this via Kevin (the agent-kevin plugin sets it).');
}
const PROFILE_ROOT = BROWSER.STATE_DIR;
const CAPTURES_ROOT = join(BROWSER.CAPTURES_DIR, 'browser');

export const log = (message: string): void => console.log(`▸ ${message}`);

const ensureDir = (path: string): string => {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
  return path;
};

/**
 * Acquire a persistent, headed context on native Windows, where bun can't drive Playwright's pipe
 * transport (oven-sh/bun#27977) and `launchPersistentContext` hangs. Spawns chromium on a CDP port
 * via the shared win32 seam and attaches; the default context carries the persisted login. Overrides
 * `context.close()` to quit chromium gracefully so cookies flush to the profile — the flow harness
 * calls `session.context.close()` in its `finally`.
 */
const launchWin32ViaCdp = async (userDataDir: string, headless: boolean): Promise<BrowserContext> => {
  const { browser, exited, killTree } = await spawnChromiumCdp(chromium, {
    profileDir: userDataDir,
    headless,
    extraArgs: [...BROWSER.INTERACTIVE_ARGS, '--no-default-browser-check', 'about:blank']
  });
  const context = browser.contexts()[0] ?? (await browser.newContext());
  context.close = async () => {
    // Quit chromium gracefully via CDP so it flushes cookies/prefs to the persistent profile. A
    // force-kill skips the flush, and a flow that runs only a few seconds never hits chromium's
    // periodic cookie commit — so the login would be lost between runs. Kill only as a fallback.
    try {
      const cdp = await browser.newBrowserCDPSession();
      void cdp.send('Browser.close').catch(() => undefined);
    } catch {
      // CDP session unavailable — fall through to the force-kill fallback.
    }
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const gracefully = await Promise.race([
      exited.then(() => true),
      new Promise<false>((resolve) => {
        fallback = setTimeout(() => resolve(false), 5_000);
      })
    ]);
    clearTimeout(fallback);
    if (!gracefully) {
      await browser.close().catch(() => undefined);
      await killTree();
    }
  };
  return context;
};

/**
 * Launches a persistent browser for the given target. The user-data dir is keyed per environment
 * so sessions never mix; screenshots are scoped per flow + run. Headed by default (manual login
 * acquires the session); `headless` reuses the persisted session without a window — it needs an
 * explicit viewport (`viewport: null` is headed-only) and cannot acquire a login, only reuse one.
 */
export const launch = async (target: Target, flowName: string, options: { headless?: boolean } = {}): Promise<Session> => {
  const headless = options.headless ?? false;
  const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
  const userDataDir = ensureDir(join(PROFILE_ROOT, target.name, 'profile'));
  const shotsDir = ensureDir(join(CAPTURES_ROOT, target.name, flowName, runStamp));
  log(`screenshots → ${shotsDir}${headless ? ' (headless)' : ''}`);

  const context =
    process.platform === 'win32'
      ? await launchWin32ViaCdp(userDataDir, headless)
      : await withBrowserLaunch(() =>
          chromium.launchPersistentContext(userDataDir, {
            headless,
            viewport: headless ? { width: 1280, height: 900 } : null,
            permissions: ['clipboard-read', 'clipboard-write'],
            args: [...BROWSER.INTERACTIVE_ARGS]
          })
        );

  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page, shotsDir, headless };
};

/**
 * Navigates to the target's authed home and blocks until the operator has logged in. No-op for
 * targets without an `auth` config (e.g. flows that just visit public pages). Returns immediately
 * if the persisted session is still valid.
 */
export const ensureLoggedIn = async (session: Session, target: Target, timeoutMs = BROWSER.LOGIN_WAIT_MS): Promise<void> => {
  if (!target.auth) {
    return;
  }
  const { loginPath, homePath } = target.auth;
  const { page } = session;
  const appOrigin = new URL(target.appUrl).origin;
  const isAuthed = (): boolean => {
    const current = new URL(page.url());
    return current.origin === appOrigin && current.pathname !== loginPath;
  };

  await page.goto(`${target.appUrl}${homePath}`, { waitUntil: 'domcontentloaded' });
  // The app can briefly render the authed route before a client-side redirect to the IdP fires —
  // settle before each check and never early-return, or an unauthenticated session false-positives.
  // Headless can only reuse a persisted session, never acquire one — fail fast with the fix.
  const deadline = Date.now() + (session.headless ? 10_000 : timeoutMs);
  let prompted = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1_500);
    if (isAuthed()) {
      log(prompted ? 'Login detected — continuing.' : `Already logged in to ${target.name}.`);
      return;
    }
    if (!prompted && !session.headless) {
      log(`👉 Log in to the ${target.name} app in the open window — I'll continue automatically once you're in.`);
      prompted = true;
    }
  }
  if (session.headless) {
    throw new Error(`Not logged in to ${target.name} (headless can't acquire a session) — run once without --headless to log in.`);
  }
  throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for manual login.`);
};

/**
 * Runs one named step with a screenshot afterwards. On failure it also dumps an accessibility
 * snapshot so wrong selectors are diagnosed in one pass instead of guessing.
 */
export const step = async <T>(session: Session, label: string, run: (page: Page) => Promise<T>): Promise<T> => {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  log(`step: ${label}`);
  try {
    const result = await run(session.page);
    await session.page.screenshot({ path: join(session.shotsDir, `${slug}.png`) }).catch(() => undefined);
    return result;
  } catch (error) {
    await session.page.screenshot({ path: join(session.shotsDir, `${slug}-FAILED.png`) }).catch(() => undefined);
    const snapshot = await session.page
      .locator('body')
      .ariaSnapshot()
      .catch(() => '(aria snapshot unavailable)');
    console.error(`✗ step failed: ${label}`);
    console.error(`  url: ${session.page.url()}`);
    console.error(`  aria snapshot:\n${snapshot}`);
    throw error;
  }
};
