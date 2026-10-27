/**
 * Skills a release folded into another, by old name, with the command that replaced each. Every
 * place that reconciles a home's permissions maps a retired skill's grant to its successor's, so a
 * dead grant never comes back and an operator's ask or deny placement carries over. Retired MCP tools
 * below migrate the same way.
 */
export const RETIRED_SKILLS: Readonly<Record<string, string>> = {
  'simple-simplify': 'engineer simplify',
  'pr-adversarial': 'adversarial-review',
  'pr-review': 'engineer review',
  'pr-walkthrough': 'engineer walkthrough',
  standup: 'attention standup',
  'where-am-i': 'attention checkpoint all',
  'morning-briefing': 'briefing morning',
  'evening-briefing': 'briefing evening',
  'quick-pulse': 'briefing pulse',
  'weekly-goals': 'goals week interview',
  'monthly-goals': 'goals month',
  'yearly-goals': 'goals year',
  'google-search-audit': 'seo audit',
  'google-search-console': 'seo console',
  'google-page-speed': 'seo speed',
  serpapi: 'seo serp',
  'open-page-rank': 'seo rank',
  'seed-export': 'seed export',
  'seed-import': 'seed import',
  'create-project': 'project create',
  'archive-project': 'project archive',
  focus: 'attention'
};

/**
 * MCP tools a release renamed, by old name, with the tool that replaced each.
 */
export const RETIRED_TOOLS: Readonly<Record<string, string>> = {
  focus_write: 'attention_write'
};

/**
 * A retired tool's rule renamed in place, or null; tool rules have no wildcards, and the server slug
 * between the plugin and the tool name is kept as written.
 */
const migrateToolGrant = (entry: string, plugin: string): string[] | null => {
  if (!entry.startsWith(`mcp__plugin_${plugin}_`)) {
    return null;
  }
  const retired = Object.keys(RETIRED_TOOLS).find((tool) => entry.endsWith(`__${tool}`));
  return retired ? [`${entry.slice(0, -retired.length)}${RETIRED_TOOLS[retired]}`] : null;
};

/**
 * A `Skill(...)` rule's name as Claude Code matches it: a leading `/` is dropped, and a trailing ` *` or
 * `:*` makes it a prefix of the skill name (arguments never take part).
 */
const ruleName = (entry: string): { name: string; prefix?: string } | null => {
  const inner = /^Skill\((.+)\)$/.exec(entry)?.[1]?.replace(/^\//, '');
  if (!inner) {
    return null;
  }
  return inner.endsWith(' *') || inner.endsWith(':*') ? { name: inner, prefix: inner.slice(0, -2) } : { name: inner };
};

const routerOf = (retired: string): string => (RETIRED_SKILLS[retired] ?? '').split(' ')[0] ?? '';

/**
 * What a permissions entry becomes once `plugin`'s retired skills and tools are gone, or null when it reaches none.
 * A rule for one retired skill becomes its successor's, wildcard kept. A prefix rule that also reached
 * retired skills stays, joined by an exact rule for each successor it no longer reaches, so a gate the
 * operator placed on a retired skill still holds for the skill that replaced it.
 */
export const migrateGrant = (entry: string, plugin: string): string[] | null => {
  const rule = ruleName(entry);
  if (!rule) {
    return migrateToolGrant(entry, plugin);
  }
  const retired = Object.keys(RETIRED_SKILLS);
  const stem = rule.prefix ?? rule.name;
  const own = retired.find((name) => `${plugin}:${name}` === stem);
  if (own) {
    return [`Skill(${plugin}:${routerOf(own)}${rule.name.slice(stem.length)})`];
  }
  const { prefix } = rule;
  if (prefix === undefined) {
    return null;
  }
  const unreached = [...new Set(retired.filter((name) => `${plugin}:${name}`.startsWith(prefix)).map(routerOf))].filter(
    (router) => !`${plugin}:${router}`.startsWith(prefix)
  );
  return unreached.length ? [entry, ...unreached.map((router) => `Skill(${plugin}:${router})`)] : null;
};

/**
 * A permissions list with every retired rule migrated, first position kept and duplicates dropped, so
 * the list reads as the operator left it.
 */
export const migrateGrants = (entries: readonly string[], plugin: string): string[] => [
  ...new Set(entries.flatMap((entry) => migrateGrant(entry, plugin) ?? [entry]))
];
