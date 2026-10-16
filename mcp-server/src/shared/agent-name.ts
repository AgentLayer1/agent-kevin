import { AGENT_SLUG, FILES } from '@/config';
import { readFileSync } from 'node:fs';

/**
 * The agent's display name — what it calls itself, as opposed to the plugin's
 * namespace (`agent-kevin`), which never changes.
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
  const name = agentNameIn(readIdentity());
  // An unsubstituted template token means init left a placeholder behind;
  // showing "{{AGENT_NAME}}" everywhere is worse than showing the default.
  if (name && !name.includes('{{')) return name;
  return AGENT_SLUG.replace(/^./, (first) => first.toUpperCase());
};

/**
 * The names this agent went by before a rename, oldest first, from `IDENTITY.md`'s
 * `- **Formerly:**` field. Read live for the same reason as the display name.
 */
export const agentFormerNames = (): string[] => formerNamesIn(readIdentity());

/** The allowlist init enforces: a name sits inside markdown link text and line parsers read it back. */
export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 -]*$/;

/** The display name an IDENTITY.md declares (`- **Name:** Scout`), or '' when it has none. */
export const agentNameIn = (identity: string): string => identity.match(NAME_FIELD)?.[2] ?? '';

/** The comma-separated `- **Formerly:**` list an IDENTITY.md declares. */
export const formerNamesIn = (identity: string): string[] =>
  (identity.match(FORMERLY_FIELD)?.[2] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

/**
 * IDENTITY.md's `**Name:** value` line: group 1 runs through the label, group 2 is the value.
 * `[ \t]`, never `\s`, so an empty field can't capture the next line.
 */
export const NAME_FIELD = /^(.*?\*\*Name:\*\*)[ \t]*(.*?)[ \t]*$/m;

/** IDENTITY.md's `**Formerly:** a, b` line, grouped like NAME_FIELD. */
export const FORMERLY_FIELD = /^(.*?\*\*Formerly:\*\*)[ \t]*(.*?)[ \t]*$/m;

/**
 * Swap one agent name for another as a whole word, in exact case. A name touching a letter,
 * digit, `-`, `/` or `\` is part of a path or identifier (`~/Documents/Agents/Kevin`,
 * `C:\Agents\Kevin`, `Documents-Agents-Kevin.git`, `X-Kevin-Test`) and stays. When the new name
 * contains the old one (`Kevin Prime`), a mention already inside it stays too, so a rerun
 * can't rename it twice.
 */
export const renameAgent = (text: string, from: string, to: string): string => {
  const bounded = `(?<![A-Za-z0-9/\\\\-])${literal(from)}(?![A-Za-z0-9/\\\\-])`;
  const pattern = to.includes(from) ? `${literal(to)}|${bounded}` : bounded;
  return text.replace(new RegExp(pattern, 'g'), () => to);
};

const literal = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** IDENTITY.md without its `Formerly` line. */
export const withoutFormerNames = (identity: string): string =>
  identity
    .split('\n')
    .filter((line) => !FORMERLY_FIELD.test(line))
    .join('\n');

const readIdentity = (): string => {
  try {
    return readFileSync(FILES.IDENTITY, 'utf-8');
  } catch {
    // no IDENTITY.md — pre-init home
    return '';
  }
};
