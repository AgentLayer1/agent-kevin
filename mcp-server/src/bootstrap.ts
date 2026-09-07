/**
 * First import of the server entrypoint: hydrate the home's `.claude/settings*.json`
 * env before `@/config` reads it. Claude Code injects that env into its own sessions;
 * Codex launches the server from the home's `.codex/config.toml` registration with only
 * `AGENT_HOME` set, so the server loads it itself.
 */
import { agentHomePath, loadSettingsEnv } from '@/shared/env';

loadSettingsEnv(agentHomePath());
