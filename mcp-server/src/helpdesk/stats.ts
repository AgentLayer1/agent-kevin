import type { HelpdeskName, HelpdeskTicket } from './types';

export const UNTAGGED = '(untagged)';

/** The statuses a pulse treats as open when no queue profile names them; SupportCandy names its own per site. */
export const OPEN_STATUSES: Partial<Record<HelpdeskName, readonly string[]>> = {
  pylon: ['new', 'waiting_on_you']
};

export interface QueueStats {
  total: number;
  /** The read stopped before the end, so `total` is a floor. */
  more: boolean;
  byStatus: Record<string, number>;
  /** A ticket counts under each of its tags; SupportCandy's category stands in for tags. */
  byTag: Record<string, number>;
  unassigned: number;
  openedInWindow: number;
}

const tally = (keys: readonly string[]): Record<string, number> =>
  Object.fromEntries(
    [...keys.reduce((counts, key) => counts.set(key, (counts.get(key) ?? 0) + 1), new Map<string, number>())].sort(
      ([, left], [, right]) => right - left
    )
  );

const labelsOf = (ticket: HelpdeskTicket): string[] => {
  if (ticket.category) {
    return [ticket.category];
  }
  return ticket.tags.length > 0 ? ticket.tags : [UNTAGGED];
};

export const queueStats = (
  tickets: readonly HelpdeskTicket[],
  { more, windowStart }: { more: boolean; windowStart: string }
): QueueStats => ({
  total: tickets.length,
  more,
  byStatus: tally(tickets.map((ticket) => ticket.status)),
  byTag: tally(tickets.flatMap(labelsOf)),
  unassigned: tickets.filter((ticket) => !ticket.assignee).length,
  openedInWindow: tickets.filter(
    (ticket) => ticket.created_at !== undefined && Date.parse(ticket.created_at) >= Date.parse(windowStart)
  ).length
});
