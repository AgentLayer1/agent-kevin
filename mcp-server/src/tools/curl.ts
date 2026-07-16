/**
 * curl_run — execute one curl request with collection-scoped secrets, returning
 * transcript-safe output.
 *
 * The api-collections skill AUTHORS requests; this tool is the one sanctioned
 * way to actually fire one (verify a draft, debug an endpoint). It runs inside
 * the MCP server so arbitrary hosts work (outside the Bash seatbelt), and it is
 * deliberately NEVER pre-granted — every call goes through a permission prompt.
 *
 * Secrets flow: args carry `{{KEY}}` placeholders, never values. The tool loads
 * the collection `.env` (readEnvFile — refuses `.kevin/secrets/`), interpolates
 * placeholders into the child's argv, then SCRUBS every loaded value back out of
 * the output before returning, so what lands in the conversation is shareable:
 * `authorization: Bearer {{ACME_API_KEY}}`. Scrubbing covers the injected
 * credentials only — a response body can still contain sensitive API data.
 *
 * NOTE: `@/config` is imported lazily inside the handler, never at module top.
 * config resolves its paths into a frozen singleton at import; importing this
 * file's pure helpers in a test must NOT freeze it before HOME-scoped tests set
 * KEVIN_HOME. The pure exports below stay config-free for exactly that reason.
 */
import { readEnvFile } from '@/shared/env';
import { defineTool, type ToolDef } from '@/shared/types';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const MAX_OUTPUT_CHARS = 12_000;

/** Flags that make curl write/read local files or config — refused outright.
 *  The tool returns response text; file I/O belongs to the operator's own shell. */
const BLOCKED_LONG = ['--output', '--output-dir', '--remote-name-all', '--dump-header', '--cookie-jar', '--trace', '--trace-ascii', '--trace-config', '--config', '--libcurl'];
const BLOCKED_SHORT = new Set(['o', 'O', 'D', 'c', 'K']);

const PLACEHOLDER = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

/** curl allows `-ooutfile` (attached value) and `-sSo out` (clusters), so a
 *  short option is blocked if its letter appears ANYWHERE in a short cluster —
 *  conservative (a blocked letter inside an attached value also refuses), but a
 *  false refusal just means "pass the flag separately"; a miss writes files. */
export function findBlockedFlag(args: string[]): string | undefined {
  return args.find((arg) => {
    if (arg.startsWith('--')) {
      return BLOCKED_LONG.some((flag) => arg === flag || arg.startsWith(`${flag}=`));
    }
    if (arg.startsWith('-') && arg.length > 1) {
      return [...arg.slice(1)].some((letter) => BLOCKED_SHORT.has(letter));
    }
    return false;
  });
}

/** Interpolate `{{KEY}}` placeholders from the env map. Throws listing missing
 *  key NAMES (never values) so the error is transcript-safe too. */
export function interpolateArgs(args: string[], env: Record<string, string>): string[] {
  const missing = new Set<string>();
  const out = args.map((arg) =>
    arg.replace(PLACEHOLDER, (match, key: string) => {
      if (env[key] === undefined || env[key] === '') {
        missing.add(key);
        return match;
      }
      return env[key];
    })
  );
  if (missing.size > 0) {
    throw new Error(`Unresolved placeholders: ${[...missing].join(', ')}. Fill these keys in the collection .env (or pass envFile).`);
  }
  return out;
}

/** Replace every injected secret VALUE with `{{KEY}}` so output is shareable.
 *  Longest values first so overlapping secrets can't leave partial leaks.
 *  Values under 4 chars are skipped — too short to be a real secret, and
 *  scrubbing them would mangle ordinary output (status codes, short numbers). */
export function scrub(text: string, env: Record<string, string>): string {
  const entries = Object.entries(env)
    .filter(([, value]) => value.length >= 4)
    .sort(([, a], [, b]) => b.length - a.length);
  return entries.reduce((acc, [key, value]) => acc.replaceAll(value, `{{${key}}}`), text);
}

const tail = (text: string, limit: number): string => (text.length <= limit ? text : `… (truncated)\n${text.slice(-limit)}`);

/** First existing collection `.env` under the reports dir — bruno adapter first, then curl. */
function defaultEnvFile(reportsDir: string): string | undefined {
  const candidates = [resolve(reportsDir, 'api', 'bruno', '.env'), resolve(reportsDir, 'api', 'curl', '.env')];
  return candidates.find((path) => existsSync(path));
}

/** The placeholder keys the args actually reference — what the run injected. */
function referencedKeys(args: string[]): string[] {
  return [...new Set(args.flatMap((arg) => [...arg.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '')))];
}

export const tools: ToolDef[] = [
  defineTool({
    name: 'curl_run',
    description:
      'Fire ONE curl request with collection-scoped secrets, returning transcript-safe output. Args are curl arguments (no leading "curl"); reference secrets as {{KEY}} placeholders — the tool interpolates them from the collection .env (default: reports/api/bruno/.env, then reports/api/curl/.env; override with envFile) and scrubs every value back out of the returned command/output, so credentials never appear in the conversation. Response bodies are NOT scrubbed beyond that — prod data stays sensitive. File-writing curl flags (-o, -D, -c, --trace, …) are refused. This tool is never pre-granted: each call prompts the operator. Use it to verify drafts from the api-collections skill or debug an endpoint — not as a general download tool.',
    inputSchema: {
      args: z.array(z.string()).min(1).describe('curl arguments, e.g. ["-X","POST","https://api.example.com/things","-H","authorization: Bearer {{ACME_API_KEY}}","-d","{\\"name\\":\\"x\\"}"]'),
      envFile: z.string().optional().describe('Path to the dotenv holding {{KEY}} values. Defaults to the personal collection .env (bruno, then curl adapter root).'),
      timeoutSeconds: z.number().int().min(1).max(300).default(30).describe('curl --max-time, default 30')
    },
    handler: async ({ args, envFile, timeoutSeconds }) => {
      const blocked = findBlockedFlag(args);
      if (blocked) {
        throw new Error(`Flag ${blocked} is not allowed — curl_run returns response text; it never writes or reads local files/config.`);
      }

      const { FOLDERS } = await import('@/config');
      const envPath = envFile ?? defaultEnvFile(FOLDERS.REPORTS);
      const env = envPath ? readEnvFile(envPath) : {};
      const argv = interpolateArgs(args, env);

      const proc = Bun.spawn(['curl', '-sS', '--max-time', String(timeoutSeconds), ...argv], {
        cwd: FOLDERS.HOME,
        stdout: 'pipe',
        stderr: 'pipe'
      });
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      const exitCode = await proc.exited;

      return {
        exitCode,
        command: `curl ${args.join(' ')}`, // as given — placeholders intact, values never echoed
        envKeys: referencedKeys(args), // names only — the keys this request injected
        envFile: envPath ?? null,
        output: scrub(tail(`${stdout}${stderr}`.trim(), MAX_OUTPUT_CHARS), env)
      };
    }
  })
];
