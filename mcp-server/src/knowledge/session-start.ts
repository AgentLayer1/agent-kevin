/**
 * Harness-agnostic SessionStart core. Used by:
 *  - Claude Code's SessionStart hook via `bin/kevin session-start --hook-protocol=claude`.
 *  - Codex CLI's SessionStart hook via `bin/kevin session-start --hook-protocol=codex`:
 *    Codex takes a hook's stdout as developer context and has no `@-import`, so the
 *    static stack (identity files, indexes, task board) is printed ahead of the same
 *    dynamic lane. The hook is registered with `additionalContextLimit: 0`, since
 *    Codex otherwise truncates a hook's output at about 2,500 tokens. See
 *    `sessionStartCodex`.
 *
 * Three disjoint paths:
 *  - **Pre-init**: nothing scaffolded here — emit the banner + setup hint. NO
 *    filesystem writes (anything that CREATES under FOLDERS.* must stay out of
 *    this path, or an empty home tree appears before the user picks a home;
 *    reading a resolved path is fine).
 *  - **Stranded**: a `SOUL.md` but no data dir — another agent's home, or this
 *    one's marker lost in a restore. Explain, and steer away from init.
 *  - **Post-init**: assemble the dynamic lane (today, last session tail, git
 *    activity, today's reports). Static identity (SOUL/IDENTITY/USER + the
 *    AGENTS.md manual) is loaded natively by the harness — Claude Code via the
 *    `@-imports` in `.claude/CLAUDE.md`, AGENTS.md-aware hosts directly.
 *
 * Always returns a result — internal errors are caught and emitted as an
 * empty payload + `error` field so the host never chokes on hook output.
 */
import { FILES, FOLDERS, PLUGIN_NAME, isInitialized } from '@/config';
import { assembleContext } from '@/context';
import { BANNER } from '@/shared/banner';
import { log as baseLog } from '@/shared/log';
import { runtimeDirName } from '@/shared/naming';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

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
      `→ ${FOLDERS.HOME} has a SOUL.md but no home marker in ${dir}/ — see the note below. Do NOT run init.`
    ].join('\n'),
    additionalContext: [
      `The ${PLUGIN_NAME} plugin is loaded and \`${FOLDERS.HOME}\` looks like an agent home (it has a SOUL.md), but its \`${dir}/\` carries no home marker (\`version.json\` or \`knowledge.json\`), which is how this agent recognises its own home. Until that's resolved the agent's data is unreachable: sessions won't be captured and its tools will refuse to run.`,
      '',
      'Two causes. Help the user work out which:',
      '',
      `1. **This is another agent's home.** Every agent's home has a SOUL.md, only this one's \`${dir}/\` carries the marker files. Launch that agent from here instead, and launch this one from its own home.`,
      `2. **This home's \`${dir}/\` state didn't survive a restore, clone, or sync.** Restore \`${dir}/version.json\` (upgrade baseline) and \`${dir}/knowledge.json\` (compile cursor) from the backup or the brain repo — both are git-tracked and either one marks the home. Without the compile cursor the next compile re-ingests everything, and without the baseline upgrade tracking resets.`,
      '',
      '**Do not suggest `init` to fix this.** Its re-run path offers to overwrite SOUL.md, IDENTITY.md, USER.md and the operating manual, which is the operator losing their agent, not repairing it.'
    ].join('\n'),
    hasIssues: true
  };
};

/**
 * The Codex session-start payload: the files Claude Code gets through the
 * `.claude/CLAUDE.md` bridge, each introduced by its home-relative path, then the
 * same dynamic lane Claude gets. Pre-init and stranded homes get Claude's guidance.
 */
export async function sessionStartCodex(): Promise<string> {
  if (!isInitialized()) {
    const guidance = existsSync(FILES.SOUL) ? strandedHomeResult().additionalContext : PRE_INIT_RESULT.systemMessage;
    return `${guidance.trim()}\n`;
  }
  const { context } = await assembleContext();
  const files = [FILES.SOUL, FILES.IDENTITY, FILES.USER, FILES.KNOWLEDGE, FILES.MEMORY, resolve(FOLDERS.PROJECTS, 'TASKS.md')]
    .filter((path) => existsSync(path))
    .map((path) => `<!-- file: ${relative(FOLDERS.HOME, path).split(sep).join('/')} -->\n${readFileSync(path, 'utf-8').trimEnd()}`);
  const lane = context.trim() ? [`<!-- session context (dynamic lane) -->\n${context.trimEnd()}`] : [];
  return [
    "<!-- kevin static context · harness: codex · delivered by the plugin's SessionStart hook because Codex has no @-import -->",
    ...files,
    ...lane
  ].join('\n\n') + '\n';
}

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
