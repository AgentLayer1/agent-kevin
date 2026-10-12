import type { PromptAutocompleteSuggestion } from 'claude-code';

import type { TaskFrontmatter } from './today';
import { OPEN_STATUSES } from './today';

const MAX_ROWS = 8;

export const isDoneArgument = (beforeToken: string): boolean => /^\/(?:[\w-]+:)?done\s+$/.test(beforeToken);

/**
 * Open tasks whose id starts with the token, then those whose title holds it, each in the task list's order.
 */
export const doneSuggestions = (tasks: readonly TaskFrontmatter[], token: string): PromptAutocompleteSuggestion[] => {
  const needle = token.toLowerCase();
  const open = tasks.filter((task) => OPEN_STATUSES.includes(task.status));
  const isIdMatch = (task: TaskFrontmatter) => task.id.toLowerCase().startsWith(needle);
  return [
    ...open.filter(isIdMatch),
    ...open.filter((task) => !isIdMatch(task) && task.title.toLowerCase().includes(needle))
  ]
    .slice(0, MAX_ROWS)
    .map((task) => ({ text: task.id, description: task.title }));
};
