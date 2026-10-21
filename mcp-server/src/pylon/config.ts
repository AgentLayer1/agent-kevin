/**
 * Pylon integration config — API base + token resolution.
 *
 * Auth is a plain admin-minted API token (no OAuth, no CLI): the operator
 * drops it into the data-dir `secrets/.env` as `PYLON_API_TOKEN` via the
 * configure-skills Helpdesk pack. The deny-gated secrets dir keeps it off the
 * Bash sandbox; the MCP server reads it through `shared/env`.
 */
import { pluginName, RUNTIME_DIR } from '@/shared/naming';
import { env, suffixedKey } from '@/shared/env';

export const PYLON_API_BASE = 'https://api.usepylon.com';

/** The default connection's key; a named one is `PYLON_API_TOKEN_<NAME>`. */
export const PYLON_TOKEN_KEY = 'PYLON_API_TOKEN';

export const pylonTokenKey = (connection?: string): string => (connection ? suffixedKey(PYLON_TOKEN_KEY, connection) : PYLON_TOKEN_KEY);

/** A named connection never falls back to the default: that token reaches a different workspace. */
export function pylonToken(connection?: string): string {
  const key = pylonTokenKey(connection);
  const token = env(key);
  if (!token) {
    throw new Error(
      `${key} not set. Add a Pylon API token to <HOME>/${RUNTIME_DIR}/secrets/.env as ${key} ` +
        `(run /${pluginName()}:configure-skills → the Helpdesk pack; a Pylon admin mints the token under Settings → API).`
    );
  }
  return token;
}
