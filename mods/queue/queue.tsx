import { atom, read, update } from 'claude-code';
import type { EngineInterface, On } from 'claude-code';

import { QUEUE_FEATURE } from '../shared/catalog';
import { TURN_REASONS } from '../shared/turns';
import type { Queue } from '../types';

const EMPTY: Queue = { pending: [], isBusy: false, isPaused: false };
const queue = atom({ plugin: 'agent-kevin', key: 'queue' } as const, EMPTY);

const drain = async ($: EngineInterface): Promise<void> => {
  // update() may rerun the change on a conflict; only the committed run's pick is sent.
  let text: string | undefined;
  await update($, queue, (current) => {
    text = current.isBusy || current.isPaused ? undefined : current.pending[0];
    return text === undefined ? current : { ...current, pending: current.pending.slice(1), isBusy: true };
  });

  if (text !== undefined) {
    const prompt = text;
    // A submit from inside a hook would wait on the turn the hook holds; a timer runs it after.
    $.clock.after(0, () => void $.prompt.submit({ text: prompt, asUser: true }));
  }
};

export const registerQueue = (on: On): void => {
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    await Promise.all(QUEUE_FEATURE.commands.map((command) => $.command.register(command)));
    return next(e);
  });

  on('command.run', { command: 'queue' }, async ($, e) => {
    const text = e.args.trim();
    if (!text) {
      return { text: 'Usage: /queue <prompt>, or /queue clear' };
    }

    if (text === 'clear') {
      let cleared = 0;
      await update($, queue, (current) => {
        cleared = current.pending.length;
        return { ...current, pending: [], isPaused: false };
      });
      return { text: `Cleared ${cleared} queued prompt${cleared === 1 ? '' : 's'}.` };
    }

    await update($, queue, (current) => ({ ...current, pending: [...current.pending, text] }));
    await drain($);
    return {};
  });

  on('turn.start', async ($, e, next) => {
    await update($, queue, (current) => ({ ...current, isBusy: true }));
    return next(e);
  });

  // Esc on a runaway task, or an error such as a rate limit, holds what waits instead of sending it into the same trouble.
  on('turn.complete', { reason: TURN_REASONS }, async ($, e, next) => {
    if (e.agentId === undefined) {
      const isPaused = e.reason === 'aborted' || e.reason === 'error';
      await update($, queue, (current) => ({ ...current, isBusy: false, isPaused: isPaused && current.pending.length > 0 }));
      await drain($);
    }
    return next(e);
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e);
    const { pending, isPaused } = await read($, queue);
    if (!pending.length || e.props.hasSurvey) {
      return below;
    }
    const { Box, Text } = $.ui.resolve(e);
    const line = isPaused
      ? `⏸ ${pending.length} queued (paused) · send a prompt to resume, /queue clear to drop`
      : `⏳ ${pending.length} queued · /queue clear to drop`;
    return (
      <Box flexDirection="column">
        <Text dimColor>{line}</Text>
        {below}
      </Box>
    );
  });
};
