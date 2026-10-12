import type { TurnCompleteReason } from 'claude-code';

/** Every way a turn can end, for a handler that only cares that it ended. */
export const TURN_REASONS: readonly TurnCompleteReason[] = ['answer', 'aborted', 'refusal', 'error'];
