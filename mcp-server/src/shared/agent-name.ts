import { FILES, PLUGIN_NAME } from '@/config';
import { readFileSync } from 'node:fs';

/**
 * The agent's display name — what it calls itself, as opposed to the plugin's
 * namespace (`agent-kevin`, `KEVIN_*`, `.kevin/`), which never changes.
 *
 * Single source: `IDENTITY.md`'s `- **Name:**` field, which is what
 * `/agent-kevin:init` writes and `/agent-kevin:rename-agent` edits. Falls back
 * to the plugin's own name (`agent-kevin` → `Kevin`) for a home that has no
 * IDENTITY.md yet (pre-init) or one scaffolded before the field existed.
 *
 * Deliberately uncached and read live. A rename edits the file mid-session, and
 * a cached value would keep the old name in the banner, the TASKS.md header, and
 * the compile prompts until the process restarted — which is exactly when an
 * operator is looking for confirmation the rename took.
 */
export const agentDisplayName = (): string => {
  try {
    const name = readFileSync(FILES.IDENTITY, 'utf-8').match(/\*\*Name:\*\*\s*(.+)$/m)?.[1]?.trim();
    // An unsubstituted template token means init left a placeholder behind;
    // showing "{{AGENT_NAME}}" everywhere is worse than showing the default.
    if (name && !name.includes('{{')) return name;
  } catch {
    // no IDENTITY.md — pre-init home
  }
  return PLUGIN_NAME.replace(/^agent-/, '').replace(/^./, (first) => first.toUpperCase());
};
