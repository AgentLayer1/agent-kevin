import { atom, read, update } from 'claude-code';
import type { EngineInterface, On, Timer } from 'claude-code';

import { cliArgv, cliError } from '../shared/cli';
import { SYNC_HISTORY_KEY, formatDuration, parseHistory, typicalMs } from '../sync/stats';
import type { Notice, NoticeActing } from '../types';

const notices = atom({ plugin: 'agent-kevin', key: 'notices' } as const, []);
// The notice whose command was pressed or started; the row steps aside until that command's turn ends.
const acting = atom({ plugin: 'agent-kevin', key: 'noticeActing' } as const, null);

const REFRESH_MS = 30 * 60_000;
const TOAST_MS = 8000;

const LEVEL_COLORS = { hint: 'cyan', nudge: 'yellow', alert: 'red' } as const;
const TONE_COLORS = { accent: 'cyan', warn: 'yellow' } as const;

// Module state: a reload drops the timer and the next session start makes a new one.
let refresher: Timer | undefined;
// Claimed before the press's first await, so a second press in the same tick finds it.
let isPressing = false;

const actsOn = (notice: Notice, skill: string): boolean =>
  notice.command === skill || notice.command.endsWith(`:${skill}`);

const isString = (data: unknown): data is string => typeof data === 'string';

const isNotice = (data: unknown): data is Notice => {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const item = data as Record<string, unknown>;
  return (
    [item.id, item.icon, item.title, item.command, item.actionLabel].every(isString) &&
    ['hint', 'nudge', 'alert'].includes(String(item.level)) &&
    Array.isArray(item.facts) &&
    item.facts.every(
      (fact: unknown) => typeof fact === 'object' && fact !== null && isString((fact as { text?: unknown }).text)
    )
  );
};

// The CLI is this plugin's own, but a list that isn't one keeps the last good list rather than breaking the band.
const parseNotices = (text: string): Notice[] | null => {
  const data: unknown = JSON.parse(text);
  return Array.isArray(data) && data.every(isNotice) ? data : null;
};

// The session root, not its cwd: a shell `cd` in a turn moves the cwd out of the home.
async function runCli($: EngineInterface, args: readonly string[]): Promise<string> {
  const { exitCode, stdout, stderr } = await $.process.run(cliArgv($.plugin.root, $.plugin.name, args), {
    cwd: await $.session.root()
  });
  if (exitCode !== 0) {
    throw cliError(stderr, args, exitCode);
  }
  return stdout;
}

/**
 * Stores the list a `notices` call prints, the sync notice carrying this machine's typical run time.
 */
async function load($: EngineInterface, args: readonly string[]): Promise<Notice[]> {
  const fresh = await runCli($, args)
    .then(parseNotices)
    .catch(() => null);
  if (fresh === null) {
    return read($, notices);
  }
  const typical = typicalMs(parseHistory(await $.store.get(SYNC_HISTORY_KEY)));
  const shown =
    typical === null
      ? fresh
      : fresh.map((notice) =>
          notice.id === 'sync'
            ? { ...notice, facts: [...notice.facts, { text: `~${formatDuration(typical)}` }] }
            : notice
        );
  await update($, notices, () => shown);
  return shown;
}

async function announce($: EngineInterface): Promise<void> {
  const [lead] = await load($, ['notices', '--row']);
  if (lead === undefined) {
    return;
  }
  void $.prompt.suggest({ text: `/${lead.command}` });
  if (lead.level === 'alert') {
    $.ui.toast(`${lead.icon}  ${lead.title}. Tab to ${lead.actionLabel.toLowerCase()}.`, { timeoutMs: TOAST_MS });
  }
}

async function act($: EngineInterface, notice: Notice): Promise<void> {
  if (isPressing) {
    return;
  }
  isPressing = true;
  try {
    if ((await read($, acting)) !== null) {
      return;
    }
    const at = await $.clock.now();
    await update($, acting, () => ({ id: notice.id, isStarted: false, at }));
  } finally {
    isPressing = false;
  }
  // Queued, not awaited: the run outlives the press. Should a host refuse the name, the typed form does the same.
  void $.command
    .run({ command: notice.command })
    .catch(() => $.prompt.submit({ text: `/${notice.command}` }))
    .catch(() => update($, acting, (current) => (current?.isStarted ? current : null)));
}

async function snooze($: EngineInterface, notice: Notice): Promise<void> {
  await load($, ['notices', 'record', notice.id, '--outcome=snoozed']);
}

async function settle($: EngineInterface): Promise<void> {
  await load($, ['notices']);
  await update($, acting, () => null);
}

// A press whose command never started (the queue dropped it) stops hiding the row once it is a refresh old.
async function refresh($: EngineInterface): Promise<void> {
  await load($, ['notices']);
  const now = await $.clock.now();
  await update($, acting, (current: NoticeActing | null) =>
    current && !current.isStarted && now - current.at >= REFRESH_MS ? null : current
  );
}

export const registerNotices = (on: On): void => {
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    const result = await next(e);
    // After the session is up: the CLI call is a process spawn the prompt shouldn't wait on.
    $.clock.after(0, () => void announce($));
    refresher?.cancel();
    refresher = $.clock.every(REFRESH_MS, () => void refresh($));
    return result;
  });

  // Typing the command by hand counts as acting on it, the same as the button.
  on('skill.prompt', { skill: /./ }, async ($, e, next) => {
    const notice = (await read($, notices)).find((item) => actsOn(item, e.skill));
    if (notice) {
      const at = await $.clock.now();
      await update($, acting, () => ({ id: notice.id, isStarted: true, at }));
      void runCli($, ['notices', 'record', notice.id, '--outcome=acted']).catch(() => undefined);
    }
    return next(e);
  });

  // The command's skill started inside the running turn, so the next main turn to end is the command's own, however it ended.
  on('turn.complete', { reason: ['answer', 'aborted', 'refusal', 'error'] }, async ($, e, next) => {
    const result = await next(e);
    if (e.agentId === undefined && (await read($, acting))?.isStarted) {
      $.clock.after(0, () => void settle($));
    }
    return result;
  });

  // Stacks above whatever renders beneath, so other features' rows share the band.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e);
    if (e.props.hasSurvey || (await read($, acting)) !== null) {
      return below;
    }
    const [top, ...waiting] = await read($, notices);
    if (top === undefined || top.level === 'hint') {
      return below;
    }
    const { Box, Button, Text } = $.ui.resolve(e);
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          {/* The trailing space survives a font that draws the glyph wider than its one cell. */}
          <Text bold color={LEVEL_COLORS[top.level]}>{`${top.icon} `}</Text>
          <Text bold>{top.title}</Text>
          {top.facts.map((fact) => (
            <Box key={fact.text} gap={1}>
              <Text dimColor>·</Text>
              <Text color={fact.tone ? TONE_COLORS[fact.tone] : undefined} dimColor={!fact.tone}>
                {fact.text}
              </Text>
            </Box>
          ))}
          <Box gap={1} marginLeft={2}>
            <Button
              key={`notice:${top.id}:act`}
              variant="primary"
              label={top.actionLabel}
              onPress={() => act($, top)}
            />
            <Button key={`notice:${top.id}:snooze`} dimColor label="Tomorrow" onPress={() => snooze($, top)} />
          </Box>
          {waiting.length ? <Text dimColor>{`+${waiting.length} more`}</Text> : null}
        </Box>
        {below}
      </Box>
    );
  });
};
