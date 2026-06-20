/**
 * Browser launch diagnostics shared by every chromium launch path (the
 * browser_* capture tools and the browser-flows harness).
 *
 * The chromium *binary* downloads fine on Linux/WSL2, but it links against
 * system shared libs (libnss3, libgbm1, libasound2, …) that aren't installed
 * on a fresh distro and don't ship with the OS the way they do on macOS. The
 * binary-exists guard passes, then launch() fails at runtime with a missing-.so
 * error. `playwright install-deps` (apt) is the fix, but it needs sudo so it
 * can't live in postinstall — surface the exact command instead of leaking a
 * raw stack trace.
 */

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
