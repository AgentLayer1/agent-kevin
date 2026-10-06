import { daysBetween } from '../../../mcp-server/src/shared/date';

export interface ReviewWatermark {
  lastRun?: string;
  brainLastRun?: string;
  snoozeUntil?: string;
  skippedOn?: string;
  skips?: number;
}

export interface ReviewDue {
  invoke: string;
  label: string;
  lastRun: string | null;
}

const MONTH = 30;
const isDate = (value: string | null | undefined): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * Whether sync should offer self-review today, and which passes. The brain pass is monthly, and a
 * never-reviewed home becomes due once its oldest session is a month old, so a fresh init stays
 * quiet. The rules pass keeps its feedback rule. Tomorrow and Skip hold both off.
 */
export const selfReviewDue = (
  review: ReviewWatermark,
  today: string,
  feedbackChangedOn: string | null,
  oldestSessionDay: string | null
): ReviewDue | null => {
  if (isDate(review.snoozeUntil) && today < review.snoozeUntil) {
    return null;
  }
  if (isDate(review.skippedOn) && daysBetween(review.skippedOn, today) < MONTH) {
    return null;
  }
  const brainDue = isDate(review.brainLastRun)
    ? daysBetween(review.brainLastRun, today) >= MONTH
    : isDate(oldestSessionDay) && daysBetween(oldestSessionDay, today) >= MONTH;
  const rulesAge = isDate(review.lastRun) ? daysBetween(review.lastRun, today) : Infinity;
  const newFeedback = feedbackChangedOn !== null && (!isDate(review.lastRun) || feedbackChangedOn >= review.lastRun);
  const rulesDue = (rulesAge >= 14 && newFeedback) || (isDate(review.lastRun) && rulesAge >= MONTH);
  if (!brainDue && !rulesDue) {
    return null;
  }
  const skipped = (review.skips ?? 0) >= 2 ? `, skipped ${review.skips} times in a row` : '';
  const passes = brainDue && rulesDue ? '' : brainDue ? ' brain' : ' rules';
  const label =
    brainDue && rulesDue ? 'Self-review' : brainDue ? 'Self-review (brain pass)' : 'Self-review (rules pass)';
  const lastRun = (brainDue ? review.brainLastRun : review.lastRun) ?? null;
  return { invoke: `self-review${passes}`, label: `${label}${skipped}`, lastRun };
};
