/**
 * Shared Google OAuth2 client for plugin-side google-* tools.
 * Client JSON + tokens live under <KEVIN_HOME>/.kevin/secrets/google/ (0700,
 * deny-gated) so they persist across plugin updates and stay off Claude's Read
 * tool + the Bash sandbox.
 *
 * One-time setup:
 *   1. Google Cloud Console → APIs & Services → Credentials → OAuth client (Desktop app)
 *   2. Download the JSON, save as `<KEVIN_HOME>/.kevin/secrets/google/google-oauth-client.json`
 *   3. Run mcp__plugin_agent-kevin_kevin__google_auth — opens browser for consent, mints + persists tokens
 */
import { FOLDERS } from '@/config';
import { log } from '@/shared/log';
import { writeJsonAtomic } from '@/shared/utils';
import { google, type Auth } from 'googleapis';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

const GOOGLE_DIR = join(FOLDERS.SECRETS, 'google');
export const CLIENT_FILE = join(GOOGLE_DIR, 'google-oauth-client.json');
const TOKENS_FILE = join(GOOGLE_DIR, 'google-tokens.json');

const SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly', 'openid'];

interface ClientCredentials {
  client_id: string;
  client_secret: string;
}

function readClient(): ClientCredentials {
  if (!existsSync(CLIENT_FILE)) {
    throw new Error(
      `OAuth client file not found at ${CLIENT_FILE}. ` +
        'Download Desktop OAuth client JSON from Google Cloud Console → APIs & Services → Credentials, save there.'
    );
  }
  const raw = JSON.parse(readFileSync(CLIENT_FILE, 'utf-8'));
  const inner = raw.installed ?? raw.web ?? raw;
  if (!inner.client_id || !inner.client_secret) {
    throw new Error(`Malformed OAuth client file at ${CLIENT_FILE} — missing client_id/secret.`);
  }
  return inner;
}

function writeTokens(tokens: object): void {
  if (!existsSync(GOOGLE_DIR)) {
    mkdirSync(GOOGLE_DIR, { recursive: true });
    chmodSync(GOOGLE_DIR, 0o700);
  }
  writeJsonAtomic(TOKENS_FILE, tokens, 0o600);
}

export function authorizedClient(): Auth.OAuth2Client {
  if (!existsSync(TOKENS_FILE)) {
    throw new Error(`Tokens not minted. Call mcp__plugin_agent-kevin_kevin__google_auth first.`);
  }
  const { client_id, client_secret } = readClient();
  const tokens = JSON.parse(readFileSync(TOKENS_FILE, 'utf-8'));
  const oauth = new google.auth.OAuth2(client_id, client_secret, tokens.redirect_uri ?? 'http://localhost');
  oauth.setCredentials(tokens);
  oauth.on('tokens', (rotated: Auth.Credentials) => {
    writeTokens({ ...JSON.parse(readFileSync(TOKENS_FILE, 'utf-8')), ...rotated });
  });
  return oauth;
}

function openInBrowser(url: string): void {
  try {
    const child =
      process.platform === 'darwin'
        ? spawn('open', [url], { detached: true, stdio: 'ignore' })
        : process.platform === 'win32'
          ? spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' })
          : spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    // user can copy from the log
  }
}

async function loopbackAuth(): Promise<Auth.Credentials & { redirect_uri: string }> {
  const client = readClient();
  const server = createServer();
  await new Promise<void>((resolveFn, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveFn);
  });
  const { port } = server.address() as AddressInfo;
  const redirect_uri = `http://127.0.0.1:${port}`;
  const oauth = new google.auth.OAuth2(client.client_id, client.client_secret, redirect_uri);

  const authUrl = oauth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: [...SCOPES] });
  log.info(`opening browser for Google OAuth. If it doesn't open, visit: ${authUrl}`);
  openInBrowser(authUrl);

  const code = await new Promise<string>((resolveFn, reject) => {
    server.on('request', (req, res) => {
      const reqUrl = new URL(req.url ?? '/', redirect_uri);
      const code = reqUrl.searchParams.get('code');
      const err = reqUrl.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      if (code) {
        res.end('Authorised. You can close this tab.');
        server.close();
        resolveFn(code);
      } else {
        const why = err ?? 'missing ?code=';
        res.end(`Authorization failed: ${why}. You can close this tab.`);
        server.close();
        reject(new Error(`OAuth denied: ${why}`));
      }
    });
  });

  const { tokens } = await oauth.getToken(code);
  return { ...tokens, redirect_uri };
}

export async function runAuthFlow(): Promise<{ ok: true; tokensFile: string; hasRefreshToken: boolean }> {
  const tokens = await loopbackAuth();
  writeTokens(tokens);
  log.info(`tokens saved to ${TOKENS_FILE}`);
  return { ok: true, tokensFile: TOKENS_FILE, hasRefreshToken: Boolean(tokens.refresh_token) };
}
