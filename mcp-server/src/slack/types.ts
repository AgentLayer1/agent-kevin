/**
 * Slack API + token shapes — only what we read. Slack's API returns lots
 * we ignore; types here cover the fields we touch.
 */

export interface SlackTokens {
  access_token: string;
  refresh_token: string;
  /** Unix epoch seconds at which `access_token` expires. */
  expires_at: number;
  user_id: string;
  user_name?: string;
  team_id?: string;
  team_name?: string;
  scope: string;
  /** Set once at first auth — used to detect when scopes need a re-auth. */
  authed_at: string;
}

/**
 * Slack's `oauth.v2.access` returns tokens in two shapes:
 * - Initial code exchange: nested under `authed_user`.
 * - `grant_type=refresh_token` rotation: at the top level (`authed_user`
 *   carries only `{id}`). Both shapes are typed here; readers pick the right
 *   one for their flow.
 */
export interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  authed_user?: {
    id: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };
  team?: { id: string; name: string };
}

export interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_archived: boolean;
  is_member: boolean;
  num_members?: number;
  topic?: { value: string };
  purpose?: { value: string };
}

export interface SlackMessage {
  type: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  /** The poster's home workspace, set on messages in a shared (Slack Connect) channel. */
  user_team?: string;
  username?: string;
  text: string;
  ts: string;
  thread_ts?: string;
  reply_count?: number;
  latest_reply?: string;
  reply_users_count?: number;
  reactions?: Array<{ name: string; count: number; users: string[] }>;
  attachments?: Array<{ title?: string; text?: string; fallback?: string }>;
}

export interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
  profile?: { display_name?: string; real_name?: string };
  deleted?: boolean;
  is_bot?: boolean;
  /** A guest: a member of our workspace who isn't one of us. */
  is_restricted?: boolean;
  is_ultra_restricted?: boolean;
  team_id?: string;
}

export interface FormattedMessage {
  channel: string;
  channel_id: string;
  user: string;
  ts: string;
  iso: string;
  text: string;
  thread_ts?: string;
  reply_count?: number;
}
