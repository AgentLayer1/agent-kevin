#!/usr/bin/env bun
/**
 * Upgrade migration for v0.9.0: a per-agent Claude subscription moves out of the home's settings.
 *
 * Claude Code 2.1.312 ignores `CLAUDE_CODE_OAUTH_TOKEN` in a home's settings files, so a token in
 * `settings.local.json` moves to `<data-dir>/secrets/.env.claude.json` (0600) with the subscription marker, the file
 * the `agent` shell launcher passes as `--settings`. A different token already there is never overwritten.
 *
 * The launcher belongs in the operator's shell profile, outside the home, so it is only reported unless
 * `AGENT_UPGRADE_OPTIONS` carries `{ "installLauncher": true }`, which the upgrade passes after the operator agrees.
 *
 * Run by `/agent-kevin:upgrade` via `run_upgrade` (outside the Bash sandbox). Idempotent; never prints the token.
 * Contract: prints a single-line JSON report as its LAST stdout line; exits non-zero on failure.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { FILES, FOLDERS, SUBSCRIPTION_MARKER } from '../../../mcp-server/src/config';
import { isRecord } from '../../../mcp-server/src/shared/json-block';
import { writeFileAtomic } from '../../../mcp-server/src/shared/utils';
import { tildifyHome } from '../../../mcp-server/src/status/format';

const VERSION = '0.9.0';
const TOKEN_KEY = 'CLAUDE_CODE_OAUTH_TOKEN';
const LAUNCHER_COMMENT = '# Claude with subscription segmentation';
const AGENT_DEFINED = /^\s*(?:function\s+agent\b|agent\s*\(\s*\))/m;
const TEMPLATE = resolve(FOLDERS.ROOT, 'templates', 'shell', process.platform === 'win32' ? 'agent.ps1' : 'agent.sh');

const SETTINGS = resolve(FOLDERS.HOME, '.claude', 'settings.local.json');

const parseObject = (file: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf-8'));
  if (!isRecord(parsed)) {
    throw new Error('not an object');
  }
  return parsed;
};

const readJson = (file: string): Record<string, unknown> | null => {
  if (!existsSync(file)) {
    return null;
  }
  try {
    return parseObject(file);
  } catch {
    throw new Error(`${file} is not a JSON object; fix it, then run the upgrade again`);
  }
};

const envOf = (settings: Record<string, unknown> | null): Record<string, unknown> =>
  settings && isRecord(settings.env) ? settings.env : {};

const tokenOf = (settings: Record<string, unknown> | null): string | null => {
  const token = envOf(settings)[TOKEN_KEY];
  return typeof token === 'string' && token.trim() ? token : null;
};

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

type TokenOutcome = 'none' | 'moved' | 'present' | 'conflict';

interface Write {
  file: string;
  text: string;
  mode: number;
}

interface TokenPlan {
  outcome: TokenOutcome;
  writes: Write[];
}

/** The settings without the token, in their original key order; an `env` left empty goes too. */
const withoutToken = (settings: Record<string, unknown>): Record<string, unknown> => {
  const rest = Object.fromEntries(Object.entries(envOf(settings)).filter(([key]) => key !== TOKEN_KEY));
  return Object.fromEntries(
    Object.entries(settings).flatMap(([key, value]): [string, unknown][] => {
      if (key !== 'env') {
        return [[key, value]];
      }
      return Object.keys(rest).length > 0 ? [[key, rest]] : [];
    })
  );
};

const subscriptionWrite = (file: Record<string, unknown> | null, token: string): Write => ({
  file: FILES.CLAUDE_SUBSCRIPTION,
  text: json({ ...file, env: { ...envOf(file), [TOKEN_KEY]: token, [SUBSCRIPTION_MARKER]: '1' } }),
  mode: 0o600
});

/** Every write the token move needs, planned before anything in the home changes. */
const planToken = (): TokenPlan => {
  const settings = readJson(SETTINGS);
  const subscription = readJson(FILES.CLAUDE_SUBSCRIPTION);
  const moving = tokenOf(settings);
  const stored = tokenOf(subscription);
  const markerMissing = envOf(subscription)[SUBSCRIPTION_MARKER] !== '1';

  if (moving === null) {
    return stored === null
      ? { outcome: 'none', writes: [] }
      : { outcome: 'present', writes: markerMissing ? [subscriptionWrite(subscription, stored)] : [] };
  }
  if (stored !== null && stored !== moving) {
    return { outcome: 'conflict', writes: [] };
  }
  const settingsWrite: Write = {
    file: SETTINGS,
    text: json(withoutToken(settings ?? {})),
    mode: statSync(SETTINGS).mode & 0o777
  };
  const fileWrites = stored === null || markerMissing ? [subscriptionWrite(subscription, moving)] : [];
  return { outcome: 'moved', writes: [...fileWrites, settingsWrite] };
};

type Shell = 'zsh' | 'bash' | 'powershell';

interface Launcher {
  shell: Shell | null;
  profile: string | null;
  installed: boolean;
  conflict: string | null;
  command: string | null;
  reload: string | null;
  appended: boolean;
}

// TODO(windows): unverified on a real box — the profile comes from pwsh itself, since a OneDrive-redirected
// Documents folder makes it unguessable.
const powershellProfile = (): string | null => {
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', '$PROFILE.CurrentUserAllHosts'], {
    encoding: 'utf-8'
  });
  const profile = result.status === 0 ? result.stdout.trim() : '';
  return profile || null;
};

const detectShell = (): { shell: Shell | null; profile: string | null } => {
  if (process.platform === 'win32') {
    return { shell: 'powershell', profile: powershellProfile() };
  }
  const name = basename(process.env.SHELL ?? '');
  if (name === 'zsh') {
    return { shell: 'zsh', profile: join(process.env.ZDOTDIR || homedir(), '.zshrc') };
  }
  if (name === 'bash') {
    return { shell: 'bash', profile: join(homedir(), '.bashrc') };
  }
  return { shell: null, profile: null };
};

const quote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;

const appendCommand = (shell: Shell, profile: string): string =>
  shell === 'powershell'
    ? `New-Item -ItemType Directory -Force '${dirname(profile)}' | Out-Null; Get-Content '${TEMPLATE}' | Add-Content '${profile}'`
    : `cat ${quote(TEMPLATE)} >> ${quote(profile)}`;

const reloadCommand = (shell: Shell, profile: string): string =>
  shell === 'powershell' ? `. '${profile}'` : `source ${tildifyHome(profile)}`;

const launcherStatus = (): Launcher => {
  const { shell, profile } = detectShell();
  const text = profile && existsSync(profile) ? readFileSync(profile, 'utf-8') : '';
  const installed = text.includes(LAUNCHER_COMMENT) || AGENT_DEFINED.test(text);
  return {
    shell,
    profile,
    installed,
    conflict: installed ? null : Bun.which('agent'),
    command: shell && profile ? appendCommand(shell, profile) : null,
    reload: shell && profile ? reloadCommand(shell, profile) : null,
    appended: false
  };
};

const installLauncher = (launcher: Launcher): Launcher => {
  if (launcher.installed || launcher.conflict || !launcher.profile) {
    return launcher;
  }
  const exists = existsSync(launcher.profile);
  const current = exists ? readFileSync(launcher.profile, 'utf-8') : '';
  const separator = current === '' ? '' : current.endsWith('\n') ? '\n' : '\n\n';
  const mode = exists ? statSync(launcher.profile).mode & 0o777 : 0o644;
  writeFileAtomic(launcher.profile, `${current}${separator}${readFileSync(TEMPLATE, 'utf-8')}`, mode);
  return { ...launcher, installed: true, appended: true };
};

try {
  const options: unknown = JSON.parse(process.env.AGENT_UPGRADE_OPTIONS || '{}');
  const wantsInstall = isRecord(options) && options.installLauncher === true;
  const plan = planToken();
  const subscriptionWritten = plan.writes.some((write) => write.file === FILES.CLAUDE_SUBSCRIPTION);
  if (subscriptionWritten) {
    mkdirSync(FOLDERS.SECRETS, { recursive: true, mode: 0o700 });
  }
  plan.writes.forEach(({ file, text, mode }) => writeFileAtomic(file, text, mode));

  const hasSubscription = plan.outcome === 'moved' || plan.outcome === 'present';
  const status = hasSubscription ? launcherStatus() : null;
  const launcher = status && wantsInstall ? installLauncher(status) : status;

  const manual = [
    ...(plan.outcome === 'conflict'
      ? [
          `${relative(FOLDERS.HOME, SETTINGS)} and ${relative(FOLDERS.HOME, FILES.CLAUDE_SUBSCRIPTION)} hold different subscription tokens; keep the right one in the second file and delete ${TOKEN_KEY} from the first`
        ]
      : []),
    ...(launcher?.conflict
      ? [`\`agent\` is already a program on this machine (${launcher.conflict}); add the launcher under another name`]
      : []),
    ...(launcher && !launcher.command
      ? [
          'the launcher has no automatic install here (an unrecognised shell, or no PowerShell 7 on Windows); add the `agent` function from the docs, Billing per agent, to your shell profile'
        ]
      : [])
  ];
  process.stdout.write(
    JSON.stringify({ ok: true, version: VERSION, token: plan.outcome, subscriptionWritten, launcher, manual }) + '\n'
  );
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(JSON.stringify({ ok: false, version: VERSION, error: message }) + '\n');
  process.exit(1);
}
