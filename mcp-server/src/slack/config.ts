/**
 * Slack integration config — paths, scopes, client_id.
 *
 * No company-specific data lives here. Each workspace creates its own Slack
 * app; its public client_id is planted into the `<HOME>/.claude/settings.local.json`
 * env block by the configure-skills Slack walk.
 *
 * Channel categorisation lives in `<HOME>/knowledge/concepts/slack-channels.md`
 * — operator-curated markdown, read by the `slack` skill and by
 * `channel-map.ts`, never written by this code. The CLI exposes primitives only.
 */
import { FOLDERS } from '@/config';
import { env } from '@/shared/env';
import { resolve } from 'node:path';

/**
 * Public OAuth client_id of the workspace's Slack app, read from env
 * (`AGENT_SLACK_CLIENT_ID`). Empty until the configure-skills Slack walk plants
 * it — the CLI surfaces a clear error in that case.
 */
export const SLACK_CLIENT_ID = env('AGENT_SLACK_CLIENT_ID') ?? '';

export const SLACK_OAUTH_AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize';
export const SLACK_OAUTH_TOKEN_URL = 'https://slack.com/api/oauth.v2.access';

/**
 * User-token scopes. No bot scopes (we only ever use user-token flow).
 * No DM scopes (`im:*`, `mpim:*`). No write scopes (`chat:write*`).
 */
export const SLACK_USER_SCOPES = [
  'channels:history',
  'channels:read',
  'groups:history',
  'groups:read',
  'users:read',
  'search:read'
] as const;

/** Slack token store, under the deny-gated secrets dir (0700) — off Claude's Read
 *  tool + the Bash sandbox. Managed by the `kevin slack` CLI. */
export const slackSecretsDir = (): string => resolve(FOLDERS.SECRETS, 'slack');
export const slackTokensFile = (): string => resolve(slackSecretsDir(), 'slack-tokens.json');

/** How many seconds before access-token expiry to proactively refresh. */
export const REFRESH_THRESHOLD_SECONDS = 60;
