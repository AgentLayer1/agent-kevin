#!/usr/bin/env bun
/**
 * SessionStart hook. Two disjoint paths:
 *
 * - preInitOutput(): no `<HOME>/CLAUDE.md` exists. Emit the banner + setup
 *   hint. NO filesystem writes — anything that walks FOLDERS.* must stay out
 *   of this path, otherwise an empty Kevin home tree gets created before
 *   the user has chosen where data should live.
 *
 * - postInitOutput(): emit the dynamic lane (today, last session tail, git
 *   activity). Static identity (AGENTS, SOUL, IDENTITY, USER) is loaded
 *   natively by Claude Code via `@-imports` in `<HOME>/CLAUDE.md`.
 */
import { isInitialized } from '../mcp-server/src/config';
import { assembleContext } from '../mcp-server/src/context';
import { AGENT_KEVIN_BANNER } from '../mcp-server/src/shared/banner';

interface HookOutput {
  systemMessage: string;
  hookSpecificOutput: {
    hookEventName: 'SessionStart';
    additionalContext: string;
  };
}

function preInitOutput(): HookOutput {
  const systemMessage = [
    '',
    AGENT_KEVIN_BANNER,
    '',
    '→ Not set up yet, run /agent-kevin:init to get started.',
  ].join('\n');

  const additionalContext = [
    "The agent-kevin plugin is loaded, but `/agent-kevin:init` hasn't been run yet — the Agent home directory and identity files don't exist.",
    '',
    "If the user asks you to do anything that requires Kevin's data (compile, briefing, task ops, knowledge lookup), suggest they run `/agent-kevin:init` first.",
    '',
    "If they ask general questions or want help with something unrelated to Kevin, answer normally — you don't need Kevin's context to be helpful.",
  ].join('\n');

  return {
    systemMessage,
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
  };
}

async function postInitOutput(): Promise<HookOutput> {
  const { context, banner } = await assembleContext();
  return {
    systemMessage: '\n' + banner,
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
  };
}

const output = isInitialized() ? await postInitOutput() : preInitOutput();
process.stdout.write(JSON.stringify(output));
