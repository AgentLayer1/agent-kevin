import { writeReport, type ReportCategory, type ReportStatus } from '@/reports';
import { defineTool, type ToolDef } from '@/shared/types';
import { z } from 'zod';

const CATEGORIES: [ReportCategory, ...ReportCategory[]] = ['briefings', 'plans'];

const STATUSES: [ReportStatus, ...ReportStatus[]] = ['clean', 'findings', 'critical', 'draft'];

export const tools: ToolDef[] = [
  defineTool({
    name: 'report_write',
    description:
      'Write a report file to reports/<category>/ AND insert a one-line entry into reports/index.md under today\'s date heading. Atomic — file and index are updated in the same call. Use this from every reporting skill (briefings, goals, self-review, flywheel) so today\'s outputs surface in SessionStart context for the next session.',
    inputSchema: {
      category: z
        .enum(CATEGORIES)
        .describe('Report category — maps to reports/<category>/ subdirectory.'),
      slug: z
        .string()
        .min(1)
        .max(60)
        .regex(/^[a-z0-9][a-z0-9-]*$/i, 'lowercase kebab-case (letters, digits, hyphens)')
        .describe('Short kebab-case slug, ≤60 chars. Filename becomes YYYY-MM-DD-HHMM-<slug>.md.'),
      title: z
        .string()
        .min(1)
        .describe('One-line headline. Shown verbatim in the index.'),
      skill: z
        .string()
        .min(1)
        .describe('Skill that produced this report (e.g. "morning-briefing", "self-review").'),
      body: z
        .string()
        .min(1)
        .describe('Markdown body (no frontmatter — the helper renders frontmatter).'),
      summary: z
        .string()
        .optional()
        .describe('Optional one-line summary stored in frontmatter (not in the index).'),
      status: z
        .enum(STATUSES)
        .optional()
        .describe(
          'Optional status. Rendered as 🟢 clean · 🟠 findings · 🔴 critical · ⏳ draft in the index.'
        ),
      tags: z.array(z.string()).optional().describe('Optional tags array stored in frontmatter.'),
      extra: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Skill-specific frontmatter keys appended after the standard ones.'),
      ext: z
        .enum(['.md', '.plan-spec.md'])
        .optional()
        .describe('File extension. Default .md; use .plan-spec.md for spec-shaped outputs.')
    },
    handler: async (args) => {
      const result = await writeReport(args);
      return {
        path: result.path,
        relPath: result.relPath,
        indexUpdated: result.indexUpdated
      };
    }
  })
];
