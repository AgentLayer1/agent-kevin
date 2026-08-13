/**
 * Harness-agnostic SessionStart core. Used by:
 *  - Claude Code's SessionStart hook via `bin/kevin session-start --hook-protocol=claude`.
 *  - Future harnesses (Codex, ...) — each adds a `--hook-protocol=<host>` envelope
 *    in `bin/kevin`. The Codex SessionStart hook happens to use the same
 *    `additionalContext` field name and semantics as Claude's, so the per-host
 *    envelope work is minimal.
 *
 * Three disjoint paths:
 *  - **Pre-init**: nothing scaffolded here — emit the banner + setup hint. NO
 *    filesystem writes (anything that CREATES under FOLDERS.* must stay out of
 *    this path, or an empty home tree appears before the user picks a home;
 *    reading a resolved path is fine).
 *  - **Stranded**: a `SOUL.md` but no data dir — another agent's home, or this
 *    one's marker lost in a restore. Explain, and steer away from init.
 *  - **Post-init**: assemble the dynamic lane (today, last session tail, git
 *    activity, today's reports). Static identity (SOUL/IDENTITY/USER/CLAUDE)
 *    is loaded natively by the harness via `@-imports` or `AGENTS.md`.
 *
 * Always returns a result — internal errors are caught and emitted as an
 * empty payload + `error` field so the host never chokes on hook output.
 */
import { FILES, FOLDERS, PLUGIN_NAME, isInitialized } from '@/config';
import { assembleContext } from '@/context';
import { BANNER } from '@/shared/banner';
import { log as baseLog } from '@/shared/log';
import { runtimeDirName } from '@/shared/naming';
import { existsSync } from 'node:fs';

const log = baseLog.session.with('start');

export interface SessionStartResult {
  systemMessage: string;
  additionalContext: string;
  hasIssues?: boolean;
  error?: string;
}

const PRE_INIT_RESULT: SessionStartResult = {
  systemMessage: ['', BANNER, '', `→ Not set up yet, run /${PLUGIN_NAME}:init to get started.`].join('\n'),
  additionalContext: [
    `The ${PLUGIN_NAME} plugin is loaded, but \`/${PLUGIN_NAME}:init\` hasn't been run yet — the Agent home directory and identity files don't exist.`,
    '',
    `If the user asks you to do anything that requires the agent's data (compile, briefing, task ops, knowledge lookup), suggest they run \`/${PLUGIN_NAME}:init\` first.`,
    '',
    "If they ask general questions or want help with something unrelated to the agent, answer normally — you don't need the agent's context to be helpful."
  ].join('\n'),
  hasIssues: false
};

/**
 * `SOUL.md` present, this agent's data dir absent. Two causes, and the operator
 * has to pick: a restore or clone that dropped `<data-dir>/`, or a session
 * launched in a *different* agent's home. Never suggest init here — it would
 * offer to overwrite the identity files that are sitting right there.
 */
const strandedHomeResult = (): SessionStartResult => {
  const dir = runtimeDirName();
  return {
    systemMessage: [
      '',
      BANNER,
      '',
      `→ ${FOLDERS.HOME} has a SOUL.md but no ${dir}/ — see the note below. Do NOT run init.`
    ].join('\n'),
    additionalContext: [
      `The ${PLUGIN_NAME} plugin is loaded and \`${FOLDERS.HOME}\` looks like an agent home (it has a SOUL.md), but it has no \`${dir}/\` directory, which is how this agent recognises its own home. Until that's resolved the agent's data is unreachable: sessions won't be captured and its tools will refuse to run.`,
      '',
      'Two causes. Help the user work out which:',
      '',
      `1. **This is another agent's home.** Every agent's home has a SOUL.md, only this one's has \`${dir}/\`. Launch that agent from here instead, and launch this one from its own home.`,
      `2. **This home's \`${dir}/\` didn't survive a restore, clone, or sync.** Recreate it with \`mkdir -p "${FOLDERS.HOME}/${dir}"\` and relaunch. Compile state (\`knowledge.json\`) and the upgrade baseline (\`version.json\`) live there, so also check whether they were backed up — without them the next compile re-ingests everything and upgrade tracking resets.`,
      '',
      '**Do not suggest `init` to fix this.** Its re-run path offers to overwrite SOUL.md, IDENTITY.md, USER.md and CLAUDE.md, which is the operator losing their agent, not repairing it.'
    ].join('\n'),
    hasIssues: true
  };
};

export async function sessionStart(): Promise<SessionStartResult> {
  try {
    if (!isInitialized()) {
      // A SOUL.md with no data dir isn't a fresh directory — it's a scaffolded
      // brain whose marker is missing, or another agent's home. Telling either
      // one to run init is wrong, and destructive for the first: init offers to
      // overwrite exactly the identity files that are sitting right there.
      if (existsSync(FILES.SOUL)) {
        log.warn(`hook fired (home marker missing at ${FOLDERS.HOME})`);
        return strandedHomeResult();
      }
      log.info('hook fired (pre-init)');
      return PRE_INIT_RESULT;
    }
    const { context, banner, hasIssues } = await assembleContext();
    // Mirror what the operator sees into the log file so context-assembly
    // issues (missing knowledge dir, git unavailable, oversized payload) are
    // diagnosable after the fact.
    const emit = hasIssues ? log.warn.bind(log) : log.info.bind(log);
    emit('hook fired (post-init)\n' + banner);
    return { systemMessage: '\n' + banner, additionalContext: context, hasIssues };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('hook failed', err);
    // Always emit a valid payload — the host treats malformed output as fatal.
    return { systemMessage: '', additionalContext: '', error: message };
  }
}
