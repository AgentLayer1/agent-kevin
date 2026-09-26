/**
 * home_history — MCP wrapper around @/home/history. It runs outside the Bash sandbox, which refuses
 * to create `.git` at the working-directory root, and writes the home's `settings.local.json`
 * grants itself so the merge is deterministic. The `history` skill owns the conversation.
 */
import { FOLDERS } from '@/config';
import { historyStatus, restorePointer, setupHistory } from '@/home/history';
import { defineTool, type ToolDef } from '@/shared/types';
import { runCodexSetup } from '@/tools/codex-setup';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const codexWired = (): boolean => existsSync(join(FOLDERS.HOME, '.codex', 'config.toml'));

export const tools: ToolDef[] = [
  defineTool({
    name: 'home_history',
    description:
      "Version history for this agent home. `status` reports on/off, where it's kept, the last snapshot, and, for a synced home, the local folder setup will use; its only write puts back a .git link a synced folder deleted (`restored`). `setup` turns it on (in place, or kept outside a cloud-synced folder with its path and sandbox grants recorded in .claude/settings.local.json) and makes the first snapshot; idempotent. When it records new grants on a home wired for Codex, it regenerates the Codex wiring too and returns that report as `codex`. A home whose version history is set up some other way is left alone. Runs outside the Bash sandbox.",
    inputSchema: {
      action: z.enum(['status', 'setup']),
      name: z.string().optional().describe("setup: the operator's name, used only when this machine has no git identity."),
      startOver: z
        .boolean()
        .optional()
        .describe('setup: when the saved history is gone (history-missing), start a new one; only after the operator agreed.')
    },
    handler: async ({ action, name, startOver }) => {
      if (action === 'setup') {
        const result = setupHistory(FOLDERS.HOME, { name, startOver });
        const wired = codexWired();
        // Codex derives its writable roots from the grants setup just wrote, so a stale profile can't reach the history folder.
        return { ...result, codexWired: wired, ...(wired && result.settingsChanged ? { codex: runCodexSetup() } : {}) };
      }
      const restored = restorePointer(FOLDERS.HOME);
      return { ...historyStatus(FOLDERS.HOME), restored, codexWired: codexWired() };
    }
  })
];
