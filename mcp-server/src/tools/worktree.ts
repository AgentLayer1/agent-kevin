/**
 * setup_worktree — MCP wrapper around the shared `setupWorktree` (see @/worktree/setup).
 *
 * The MCP server runs outside the Bash command sandbox, so `git worktree add` here can write
 * the main repo's `.git/config` and the checked-out config files (`.vscode/settings.json`,
 * `.mcp.json`) that the seatbelt denies when git runs under the Bash tool. The skill decides
 * WHICH repo (it knows the operator's layout) and passes the main checkout path; this tool
 * does the mechanical create + bootstrap. The same logic backs the `kevin worktree` CLI.
 */
import { defineTool, type ToolDef } from '@/shared/types';
import { removeWorktree, setupWorktree } from '@/worktree/setup';
import { z } from 'zod';

export const tools: ToolDef[] = [
  defineTool({
    name: 'setup_worktree',
    description:
      'Create a sibling git worktree and bootstrap it (copy gitignored local files → install deps → build), running outside the Bash sandbox so git can write .git/config and checked-out config files. Pin the repo first, then pass the absolute path to its MAIN checkout. Returns the worktree path, branch, copied files, and per-step output. Read-only against the source checkout.',
    inputSchema: {
      repoPath: z
        .string()
        .describe(
          'Absolute path to the MAIN checkout of the repo the worktree is for (the skill resolves which repo).'
        ),
      branch: z
        .string()
        .describe(
          'Branch name — pass a short, descriptive name WITHOUT a type prefix (no "feat/", "chore/", "test/"). It is always namespaced under the operator (e.g. "my-thing" → "basem/my-thing"); a name already under that namespace is kept as-is. Created with -b; if it already exists, it is checked out instead.'
        ),
      baseBranch: z
        .string()
        .optional()
        .describe(
          'Explicit branch/ref to start the new branch from (e.g. "main"). Overrides auto-detection (dev → develop → main → master → current HEAD). Must resolve in the repo.'
        ),
      slug: z
        .string()
        .optional()
        .describe("Folder suffix for the worktree dir (<repo>-<slug>). Defaults to the branch's last path segment."),
      extraInstalls: z
        .array(z.string())
        .optional()
        .describe(
          'Relative subdirs with their own lockfile to `install` after the main bootstrap (e.g. ["packages/standalone-cli"]). Must be relative, no "..".'
        )
    },
    handler: async (args) => setupWorktree(args)
  }),
  defineTool({
    name: 'remove_worktree',
    description:
      "Tear down a git worktree safely, running outside the Bash sandbox so `git worktree remove` can write the main repo's .git/config. Refuses outright if the worktree has UNCOMMITTED changes (returns status `blocked-uncommitted` — tell the operator to commit first; `force` does NOT override this). If the branch has committed-but-UNPUSHED work it returns `blocked-unpushed` unless `force` is set — surface that and ask the operator to confirm before re-calling with force. Pass `dryRun: true` first as a pre-check: it returns the same statuses (`removable` when the gates pass) WITHOUT touching anything, so the skill can unwire the VS Code workspace only once removal is guaranteed to proceed. Never passes `git worktree remove --force` — if git refuses (dirty/locked) or a leftover can't be deleted, it returns `status: 'failed'` (nothing force-removed). Runs the repo's `clean` script (e.g. `pnpm run clean`) before removal when present. Leaves the branch intact unless `deleteBranch` is set. Returns { status, removed, branch, branchDeleted, uncommitted, unpushed, cleaned, steps }.",
    inputSchema: {
      worktreePath: z.string().describe('Absolute path to the worktree to remove (never the main checkout).'),
      deleteBranch: z
        .boolean()
        .optional()
        .describe(
          "Also delete the worktree's branch after removal. Off by default — only set it when the operator explicitly asks to delete the branch too."
        ),
      force: z
        .boolean()
        .optional()
        .describe(
          'Proceed when the branch has committed-but-unpushed commits (the operator confirmed "yes, remove it anyway"). Never overrides uncommitted changes.'
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe(
          'Pre-check only: report the status (`removable` / `blocked-*`) without running the clean script, removing the worktree, or deleting the branch. Use it before unwiring the VS Code workspace.'
        )
    },
    handler: async (args) => removeWorktree(args)
  })
];
