/**
 * Slack OAuth v2 with PKCE — public client, no client_secret.
 *
 * Confirmed GA 2026-03-30: https://docs.slack.dev/changelog/2026/03/30/pkce/
 *
 * Flow: code_verifier (random 64B b64url) → code_challenge (SHA-256, b64url) →
 * browser to /oauth/v2/authorize → localhost callback → POST /oauth.v2.access
 * with code + code_verifier (no client_secret) → access + refresh tokens.
 *
 * Refresh tokens rotate on every refresh and expire after 30d of inactivity.
 */
import { agentDisplayName } from '@/shared/agent-name';
import { log as baseLog } from '@/shared/log';
import { pluginName } from '@/shared/naming';
import { writeJsonAtomic } from '@/shared/utils';
import {
  REFRESH_THRESHOLD_SECONDS,
  SLACK_CLIENT_ID,
  SLACK_OAUTH_AUTHORIZE_URL,
  SLACK_OAUTH_TOKEN_URL,
  SLACK_USER_SCOPES,
  slackSecretsDir,
  slackTokensFile
} from './config';
import type { SlackOAuthResponse, SlackTokens } from './types';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const AGENT_CLI = pluginName().replace(/^agent-/, '');

const log = baseLog.slack.with('oauth');

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(64));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function ensureConfigDir(): void {
  const dir = slackSecretsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o700);
  }
}

function openInBrowser(url: string): void {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(opener, [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // operator can paste from terminal
  }
}

function assertClientConfigured(): void {
  if (!SLACK_CLIENT_ID) {
    throw new Error(
      'AGENT_SLACK_CLIENT_ID is not set in the env. ' +
        `Run \`/${pluginName()}:configure-skills\` → Slack, which walks you through creating the Slack app and plants its Client ID ` +
        'in <HOME>/.claude/settings.local.json under env.'
    );
  }
}

/**
 * Defense-in-depth: refuse any token whose scopes include write or DM
 * capabilities. Slack only grants what we request in the OAuth URL (so this
 * shouldn't fire), but if it ever does (workspace policy override, future code
 * change adds a scope by accident, malicious tampering), we fail loud at the
 * moment the token is minted rather than discovering it mid-operation.
 */
function assertReadOnlyScopes(scopeString: string): void {
  const scopes = scopeString
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const violations = scopes.filter((s) =>
    /(:write|^chat:write|^im:|^mpim:|^commands$|^incoming-webhook$|^files:write|^pins:write|^reactions:write|^usergroups:write|^bookmarks:write)/i.test(
      s
    )
  );
  if (violations.length > 0) {
    throw new Error(
      `Refusing token with non-read scopes: ${violations.join(', ')}. ` +
        `The ${AGENT_CLI} slack CLI is read-only by design. Re-create the Slack app at https://api.slack.com/apps ` +
        `with ONLY user-token scopes from the read-only set (channels:history, channels:read, groups:history, ` +
        `groups:read, users:read, search:read) and re-run \`${AGENT_CLI} slack auth\`.`
    );
  }
}

export function loadTokens(): SlackTokens {
  const tokensPath = slackTokensFile();
  if (!existsSync(tokensPath)) {
    throw new Error(`Slack tokens not found at ${tokensPath}. Run \`${AGENT_CLI} slack auth\` to authenticate.`);
  }
  let raw: string;
  try {
    raw = readFileSync(tokensPath, 'utf-8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(
        `Slack tokens at ${tokensPath} exist but can't be read (${code}). This is the secrets deny-gate: ` +
          `call the slack_* MCP tools (which run in the unsandboxed MCP server), not the \`${AGENT_CLI} slack\` CLI over a sandboxed shell.`
      );
    }
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      `Slack tokens file at ${tokensPath} is corrupted. Delete it and re-run \`${AGENT_CLI} slack auth\`.`
    );
  }
}

function persistTokens(tokens: SlackTokens): void {
  ensureConfigDir();
  writeJsonAtomic(slackTokensFile(), tokens, 0o600);
}

/** Returns a valid access token, refreshing if expired or close to it. */
export async function getAccessToken(): Promise<string> {
  let tokens = loadTokens();
  const now = Math.floor(Date.now() / 1000);
  if (tokens.expires_at - now > REFRESH_THRESHOLD_SECONDS) {
    return tokens.access_token;
  }
  tokens = await refreshTokens(tokens);
  return tokens.access_token;
}

async function refreshTokens(current: SlackTokens): Promise<SlackTokens> {
  assertClientConfigured();
  log.info('refreshing access token');

  const body = new URLSearchParams({
    client_id: SLACK_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: current.refresh_token
  });

  const res = await fetch(SLACK_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = (await res.json()) as SlackOAuthResponse;
  // Refresh-token grant returns tokens at the top level; authed_user is
  // present but only carries {id}. Fall back to authed_user for the
  // hypothetical case where Slack ever nests them on a rotation.
  const access_token = data.access_token ?? data.authed_user?.access_token;
  const refresh_token = data.refresh_token ?? data.authed_user?.refresh_token;
  const scope = data.scope ?? data.authed_user?.scope ?? current.scope;
  const expires_in = data.expires_in ?? data.authed_user?.expires_in ?? 43200;
  if (!data.ok || !access_token) {
    throw new Error(
      `Token refresh failed: ${data.error ?? 'unknown'}. ` +
        `Refresh tokens expire after 30 days of inactivity — re-run \`${AGENT_CLI} slack auth\` to re-authenticate.`
    );
  }

  assertReadOnlyScopes(scope);
  const next: SlackTokens = {
    ...current,
    access_token,
    refresh_token: refresh_token ?? current.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + expires_in,
    scope
  };
  persistTokens(next);
  return next;
}

export async function runAuthFlow(): Promise<SlackTokens> {
  assertClientConfigured();

  const { verifier, challenge } = generatePkce();
  const stateParam = b64url(randomBytes(32));

  const server = createServer();
  await new Promise<void>((resolveFn, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveFn);
  });
  const { port } = server.address() as AddressInfo;
  const redirect_uri = `http://localhost:${port}/callback`;

  const authUrl = new URL(SLACK_OAUTH_AUTHORIZE_URL);
  authUrl.searchParams.set('client_id', SLACK_CLIENT_ID);
  authUrl.searchParams.set('user_scope', SLACK_USER_SCOPES.join(','));
  authUrl.searchParams.set('redirect_uri', redirect_uri);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', stateParam);

  log.info('opening browser for Slack OAuth');
  log.info(`if it doesn't open, visit: ${authUrl.toString()}`);
  openInBrowser(authUrl.toString());

  const code = await new Promise<string>((resolveFn, reject) => {
    const timeout = setTimeout(
      () => {
        server.close();
        reject(
          new Error(
            `OAuth timed out after 5 minutes — re-run \`${AGENT_CLI} slack auth\` and complete the browser flow.`
          )
        );
      },
      5 * 60 * 1000
    );

    server.on('request', (req, res) => {
      const reqUrl = new URL(req.url ?? '/', redirect_uri);
      const code = reqUrl.searchParams.get('code');
      const err = reqUrl.searchParams.get('error');
      const returnedState = reqUrl.searchParams.get('state');
      const settle = (
        status: number,
        body: string,
        outcome: { ok: true; code: string } | { ok: false; err: Error }
      ) => {
        clearTimeout(timeout);
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(body);
        server.close();
        if (outcome.ok) resolveFn(outcome.code);
        else reject(outcome.err);
      };
      if (err)
        return settle(400, `Slack OAuth failed: ${err}. You can close this tab.`, {
          ok: false,
          err: new Error(`OAuth denied: ${err}`)
        });
      if (!code)
        return settle(400, 'Slack OAuth failed: missing ?code= parameter. You can close this tab.', {
          ok: false,
          err: new Error('OAuth callback missing code')
        });
      if (returnedState !== stateParam)
        return settle(400, 'Slack OAuth failed: state mismatch (CSRF guard). You can close this tab.', {
          ok: false,
          err: new Error('OAuth state mismatch')
        });
      settle(200, `${agentDisplayName()} authenticated to Slack. You can close this tab.`, { ok: true, code });
    });
  });

  const body = new URLSearchParams({
    client_id: SLACK_CLIENT_ID,
    code,
    code_verifier: verifier,
    redirect_uri
  });
  const exchange = await fetch(SLACK_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = (await exchange.json()) as SlackOAuthResponse;
  if (!data.ok || !data.authed_user?.access_token || !data.authed_user.refresh_token || !data.authed_user.scope) {
    throw new Error(`Slack token exchange failed: ${data.error ?? JSON.stringify(data)}`);
  }
  assertReadOnlyScopes(data.authed_user.scope);
  const expires_in = data.authed_user.expires_in ?? 43200;
  const tokens: SlackTokens = {
    access_token: data.authed_user.access_token,
    refresh_token: data.authed_user.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + expires_in,
    user_id: data.authed_user.id,
    team_id: data.team?.id,
    team_name: data.team?.name,
    scope: data.authed_user.scope,
    authed_at: new Date().toISOString()
  };
  persistTokens(tokens);
  return tokens;
}
