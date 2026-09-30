/**
 * Playbook names a router skill's SKILL.md links to, in order, without duplicates. A playbook is a
 * `[name](references/playbooks/<file>.md)` link; the name is how the operator asks for it.
 */
export const routerPlaybooks = (router: string): string[] => [
  ...new Set([...router.matchAll(/\[([^\]]+)\]\(references\/playbooks\/[^)]+\)/g)].map((match) => match[1] ?? ''))
];
