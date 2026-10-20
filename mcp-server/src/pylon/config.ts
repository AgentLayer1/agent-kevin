/**
 * Pylon integration config — API base + token resolution.
 *
 * Auth is a plain admin-minted API token (no OAuth, no CLI): the operator
 * drops it into the data-dir `secrets/.env` as `PYLON_API_TOKEN` via the
 * configure-skills Pylon or Helpdesk pack. The deny-gated secrets dir keeps it off the
 * Bash sandbox; the MCP server reads it through `shared/env`.
 */
import { pluginName, RUNTIME_DIR } from '@/shared/naming';
import { env } from '@/shared/env';

export const PYLON_API_BASE = 'https://api.usepylon.com';

export function pylonToken(): string {
  const token = env('PYLON_API_TOKEN');
  if (!token) {
    throw new Error(
      `PYLON_API_TOKEN not set. Add a Pylon API token to <HOME>/${RUNTIME_DIR}/secrets/.env as PYLON_API_TOKEN ` +
        `(run /${pluginName()}:configure-skills → the Pylon or Helpdesk pack; a Pylon admin mints the token under Settings → API).`
    );
  }
  return token;
}
