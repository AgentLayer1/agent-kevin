/**
 * Skills a release folded into another, by old name, with the command that replaced each. Every
 * place that reconciles a home's permissions maps a retired skill's grant to its successor's, so a
 * dead grant never comes back and an operator's ask or deny placement carries over.
 */
export const RETIRED_SKILLS: Readonly<Record<string, string>> = {
  'simple-simplify': 'engineer simplify',
  'pr-adversarial': 'adversarial-review',
  'pr-review': 'engineer review',
  'pr-walkthrough': 'engineer walkthrough',
  standup: 'focus standup',
  'where-am-i': 'focus where-am-i',
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
  'archive-project': 'project archive'
};

/** Cadence watermark keys the goals skills stamped before they became one skill. */
export const RETIRED_CADENCE_KEYS: Readonly<Record<string, string>> = {
  'weekly-goals': 'goals-week',
  'monthly-goals': 'goals-month',
  'yearly-goals': 'goals-year'
};

// A grant may carry an argument wildcard (`Skill(plugin:name *)` or `Skill(plugin:name:*)`), kept as is.
const SKILL_GRANT = /^Skill\(([^:()\s]+):([^:()\s]+)((?: \*|:\*)?)\)$/;

/** The grant replacing `entry` when it names one of `plugin`'s retired skills; null for any other entry. */
export const successorGrant = (entry: string, plugin: string): string | null => {
  const [, owner, skill, suffix] = SKILL_GRANT.exec(entry) ?? [];
  const successor =
    owner === plugin && skill && Object.hasOwn(RETIRED_SKILLS, skill) ? RETIRED_SKILLS[skill] : undefined;
  return successor ? `Skill(${plugin}:${successor.split(' ')[0]}${suffix ?? ''})` : null;
};

/**
 * A permissions list with every retired grant replaced by its successor's, first position kept and
 * duplicates dropped, so the list reads as the operator left it.
 */
export const migrateGrants = (entries: readonly string[], plugin: string): string[] => [
  ...new Set(entries.map((entry) => successorGrant(entry, plugin) ?? entry))
];
