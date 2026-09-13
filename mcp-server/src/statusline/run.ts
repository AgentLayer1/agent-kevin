/**
 * `kevin statusline`: Claude Code's status-line JSON in on stdin, the rendered rows out.
 * Runs on every render tick, so it stays clear of the home resolution and settings walk the
 * rest of the CLI does: the folder comes from the payload, the emoji from the launch
 * directory's IDENTITY.md, and the branch from one bounded git call. Never fails the host:
 * a payload it cannot read renders nothing and exits 0.
 */
import { renderStatusLine, type StatusLinePayload } from '@/statusline/render';
import { statusLineSetting } from '@/statusline/setting';
import { renderSubagentRows, type SubagentPayload } from '@/statusline/subagent';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const GIT_TIMEOUT_MS = 1000;

/** The current branch, or empty when the directory is not a repository or git does not answer in time. */
const currentBranch = (dir: string): string => {
  try {
    const proc = spawnSync('git', ['-c', 'core.useBuiltinFSMonitor=false', 'branch', '--show-current'], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: GIT_TIMEOUT_MS,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
    });
    return proc.status === 0 ? proc.stdout.trim() : '';
  } catch {
    return '';
  }
};

/** The `**Emoji:**` field of the launch directory's IDENTITY.md, when the session runs from an agent home. */
const identityEmoji = (dir: string | undefined): string | undefined => {
  if (!dir) return undefined;
  try {
    const emoji = readFileSync(resolve(dir, 'IDENTITY.md'), 'utf-8').match(/\*\*Emoji:\*\*[ \t]*(\S+)/)?.[1];
    return emoji && !emoji.includes('{{') ? emoji : undefined;
  } catch {
    return undefined;
  }
};

const parse = <T>(raw: string): T | undefined => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
};

/** Awaited so the caller can exit right after: a pipe write is not guaranteed to have flushed when it returns. */
const print = (text: string): Promise<number> => Bun.write(Bun.stdout, text);

/**
 * `--setting` prints the settings entry that runs this very script, for init and upgrade to
 * merge; `--subagent` renders the subagent panel rows; otherwise the two-line footer.
 */
export const runStatusLine = async (args: string[], binPath: string): Promise<void> => {
  if (args.includes('--setting')) {
    await print(`${JSON.stringify({ statusLine: statusLineSetting(binPath) }, null, 2)}\n`);
    return;
  }
  const raw = await Bun.stdin.text();
  if (args.includes('--subagent')) {
    const rows = renderSubagentRows(parse<SubagentPayload>(raw) ?? {});
    if (rows) await print(`${rows}\n`);
    return;
  }
  const payload = parse<StatusLinePayload>(raw);
  if (!payload) return;
  const dir = payload.workspace?.current_dir ?? payload.cwd;
  await print(
    renderStatusLine(payload, {
      branch: dir ? currentBranch(dir) : '',
      emoji: identityEmoji(payload.workspace?.project_dir ?? dir)
    })
  );
};
