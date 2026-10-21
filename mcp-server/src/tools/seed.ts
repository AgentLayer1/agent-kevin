/**
 * Seed tools — one-shot agent handoff (see @/seed/format for the bundle spec).
 *
 * The seed skill's export playbook owns the interview + per-file review gate; these
 * tools are the mechanics. They run outside the Bash sandbox (MCP server), so
 * import can merge settings.json / .mcp.json and ensure the secrets store —
 * the writes the seatbelt denies under the Bash tool.
 */
import { defineTool, type ToolDef } from '@/shared/types';
import { exportSeed } from '@/seed/export';
import { SEED_AUDIENCES } from '@/seed/format';
import { importSeed } from '@/seed/import';
import { scanSeed } from '@/seed/scan';
import { z } from 'zod';

export const tools: ToolDef[] = [
  defineTool({
    name: 'seed_scan',
    description:
      'Read-only: detect what this home could hand a teammate as a seed bundle — agent name (custom vs template), identity divergence, concepts (template-identical flagged), projects with README/roadmap/helpdesk queue profile, custom skills (symlinked skills.sh installs listed separately, they are not exportable), custom browser flows, custom scripts, rules, HOME .mcp.json servers with the env key NAMES they reference, active packs, classified permission entries (core / pack / skill / custom), and settings.local.json env key names. Feeds the interview of the seed export playbook. Never reads secret values.',
    inputSchema: {},
    handler: async () => scanSeed()
  }),
  defineTool({
    name: 'seed_export',
    description:
      "Build a seed bundle zip from an APPROVED selection — call only after the seed export interview + per-file review gate. Validates every path against the seed format allowed roots (IDENTITY.md, SOUL.md, AGENTS.md — append-only on import, roadmap.html, knowledge/concepts/, projects/<slug>/{README.md,roadmap.html,helpdesk.md}, .claude/{skills,rules}/, assets/, scripts/), stages files + manifest.json, zips. Directories in `include` expand recursively; a `.env` inside one is left out and reported. When `agentName` differs from the home's own name, the bundled IDENTITY.md and SOUL.md say the new name (reported as `renamed`), and this home's path inside carried MCP entries becomes a placeholder the recipient's home replaces. `extras` carries skill-authored content (the manual overlay). Setup travels as manifest fields: permission entries, secret key NAMES, settings env key NAMES, MCP server entries — never values. Read-only against the home; the zip lands under reports/seeds/ unless `out` is given.",
    inputSchema: {
      include: z.array(z.string()).describe('Home-relative paths (files or directories) approved for export.'),
      agentName: z
        .string()
        .describe('Display name the bundle carries (e.g. "Scout"); a new name renames the bundled identity files.'),
      audience: z
        .enum(SEED_AUDIENCES)
        .optional()
        .describe(
          '"self" for the operator\'s own second agent, "teammate" for anyone else (the export interview asks).'
        ),
      extras: z
        .array(z.object({ path: z.string(), content: z.string() }))
        .optional()
        .describe('Skill-authored bundle content, e.g. [{path: "AGENTS.md", content: <curated overlay>}].'),
      permissions: z
        .object({
          allow: z.array(z.string()).optional(),
          ask: z.array(z.string()).optional(),
          deny: z.array(z.string()).optional()
        })
        .optional()
        .describe(
          'Reviewed permission entries the recipient should inherit (pack grants and denies + approved custom entries).'
        ),
      secretKeys: z
        .array(z.string())
        .optional()
        .describe(
          'Secret env key NAMES the setup needs (recipient fills values in .state/secrets/.env). Never values.'
        ),
      settingsEnv: z
        .array(z.string())
        .optional()
        .describe('Non-secret env key NAMES planted empty in the recipient settings.local.json env block.'),
      mcpServers: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('HOME .mcp.json server entries to carry (structure references env keys, never values).'),
      out: z.string().optional().describe('Absolute output path for the zip (default: <HOME>/reports/seeds/...).')
    },
    handler: async (args) => exportSeed(args)
  }),
  defineTool({
    name: 'seed_import',
    description:
      "Overlay a seed bundle onto THIS initialized home (fork semantics — imported files become the recipient's own). Validates containment (only seed-format roots are writable; settings, secrets and the data dir are unreachable by payload) and payload hashes before any write. the AGENTS.md entry APPENDS to the scaffolded manual rather than replacing it (upgrades carry the appended section like any operator customization). Merges manifest permissions into settings.json (dedupe), MCP servers into .mcp.json (existing names never clobbered), plants empty settings.local.json env placeholders, ensures the secrets store exists, and returns the secret key NAMES the operator must fill in their editor. Run with dryRun first: it returns the full plan including conflicts (existing files that differ), then confirm with the operator before re-running with overwrite.",
    inputSchema: {
      bundlePath: z.string().describe('Absolute path to the seed bundle zip.'),
      overwrite: z
        .boolean()
        .optional()
        .describe(
          'Overwrite existing files that differ from the bundle. Only after the operator confirmed the conflict list.'
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe('Report the full plan (writes, conflicts, merges) without touching anything.')
    },
    handler: async (args) => importSeed(args)
  })
];
