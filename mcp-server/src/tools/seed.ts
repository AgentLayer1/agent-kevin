/**
 * Seed tools — one-shot agent handoff (see @/seed/format for the bundle spec).
 *
 * The /seed-export skill owns the interview + per-file review gate; these
 * tools are the mechanics. They run outside the Bash sandbox (MCP server), so
 * import can merge settings.json / .mcp.json and ensure the secrets store —
 * the writes the seatbelt denies under the Bash tool.
 */
import { defineTool, type ToolDef } from '@/shared/types';
import { exportSeed } from '@/seed/export';
import { importSeed } from '@/seed/import';
import { scanSeed } from '@/seed/scan';
import { z } from 'zod';

export const tools: ToolDef[] = [
  defineTool({
    name: 'seed_scan',
    description:
      'Read-only: detect what this home could hand a teammate as a seed bundle — agent name (custom vs template), identity divergence, concepts (template-identical flagged), projects with README/roadmap, custom skills (symlinked skills.sh installs listed separately, they are not exportable), rules, HOME .mcp.json servers with the env key NAMES they reference, active packs, classified permission entries (core / pack / skill / custom), and settings.local.json env key names. Feeds the /seed-export interview. Never reads secret values.',
    inputSchema: {},
    handler: async () => scanSeed()
  }),
  defineTool({
    name: 'seed_export',
    description:
      'Build a seed bundle zip from an APPROVED selection — call only after the /seed-export interview + per-file review gate. Validates every path against the seed format allowed roots (IDENTITY.md, SOUL.md, CLAUDE.local.md, roadmap.html, knowledge/concepts/, projects/<slug>/{README.md,roadmap.html}, .claude/{skills,rules,assets}/), stages files + manifest.json, zips. Directories in `include` expand recursively. `extras` carries skill-authored content (the CLAUDE overlay). Setup travels as manifest fields: permission entries, secret key NAMES, settings env key NAMES, MCP server entries — never values. Read-only against the home; the zip lands under reports/seeds/ unless `out` is given.',
    inputSchema: {
      include: z.array(z.string()).describe('Home-relative paths (files or directories) approved for export.'),
      agentName: z.string().describe('Display name the bundle carries (from IDENTITY.md, e.g. "Scout").'),
      extras: z
        .array(z.object({ path: z.string(), content: z.string() }))
        .optional()
        .describe('Skill-authored bundle content, e.g. [{path: "CLAUDE.local.md", content: <curated overlay>}].'),
      permissions: z
        .object({ allow: z.array(z.string()).optional(), ask: z.array(z.string()).optional() })
        .optional()
        .describe('Reviewed permission entries the recipient should inherit (pack grants + approved custom entries).'),
      secretKeys: z
        .array(z.string())
        .optional()
        .describe(
          'Secret env key NAMES the setup needs (recipient fills values in .kevin/secrets/.env). Never values.'
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
      "Overlay a seed bundle onto THIS initialized home (fork semantics — imported files become the recipient's own). Validates containment (only seed-format roots are writable; settings/secrets/.kevin are unreachable by payload) and payload hashes before any write. CLAUDE.local.md appends rather than replaces. Merges manifest permissions into settings.json (dedupe), MCP servers into .mcp.json (existing names never clobbered), plants empty settings.local.json env placeholders, ensures the secrets store exists, and returns the secret key NAMES the operator must fill in their editor. Run with dryRun first: it returns the full plan including conflicts (existing files that differ), then confirm with the operator before re-running with overwrite.",
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
