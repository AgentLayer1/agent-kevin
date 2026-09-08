/**
 * First import of the server entrypoint: hydrate the home's `.claude/settings*.json`
 * env before anything resolves the home or loads secrets. Claude Code injects that env
 * into its own sessions; Codex launches the server from the home's `.codex/config.toml`
 * registration with only the home variables set, so the server loads it itself. The
 * walk starts at the registered home when one is named, else at the cwd.
 */
import { resolveEnv } from '@/shared/naming';
import { expandTilde } from '@/shared/paths';
import { loadSettingsEnv } from '@/shared/settings-env';

const registeredHome = resolveEnv('AGENT_HOME');
loadSettingsEnv(registeredHome ? expandTilde(registeredHome) : process.cwd());
