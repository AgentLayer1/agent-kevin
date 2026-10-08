import { atom, read, update } from 'claude-code';
import type { EngineInterface, On, Timer } from 'claude-code';

import { cliArgv, cliError } from '../shared/cli';
import { averageMs, formatDuration, parseHistory } from '../sync/stats';
import type { Notice, NoticeFact } from '../types';

const notices = atom({ plugin: 'agent-kevin', key: 'notices' } as const, []);
// Set when a notice's command starts, so its row steps aside until the turn that ran it ends.
const noticeSuppressed = atom({ plugin: 'agent-kevin', key: 'noticeSuppressed' } as const, false);

const REFRESH_MS = 30 * 60_000;
const TOAST_MS = 8000;
const SYNC_HISTORY_KEY = 'sync-history';

const LEVEL_COLORS = { hint: 'cyan', nudge: 'yellow', alert: 'red' } as const;
const TONE_COLORS = { accent: 'cyan', good: 'green', warn: 'yellow' } as const;

// Module state: a reload drops the timer and the next session start makes a new one.
let refresher: Timer | undefined;
let isRefreshDue = false;

const actsOn = (notice: Notice, skill: string): boolean =>
  notice.command === skill || notice.command.endsWith(`:${skill}`);

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

async function refresh($: EngineInterface): Promise<Notice[]> {
  const fresh = await runCli($, ['notices'])
    .then((text) => JSON.parse(text) as Notice[])
    .catch(() => null);
  if (fresh === null) {
    return read($, notices);
  }
  await update($, notices, () => fresh);
  await update($, noticeSuppressed, () => false);
  return fresh;
}

async function record($: EngineInterface, id: string, outcome: 'acted' | 'snoozed'): Promise<void> {
  await runCli($, ['notices', 'record', id, `--outcome=${outcome}`]).catch(() => undefined);
}

async function act($: EngineInterface, notice: Notice): Promise<void> {
  await update($, noticeSuppressed, () => true);
  // Queued, not awaited: the run outlives the press. Should a host refuse the name, the typed form does the same.
  void $.command.run({ command: notice.command }).catch(() => $.prompt.submit({ text: `/${notice.command}` }));
}

async function announce($: EngineInterface): Promise<void> {
  const [top] = await refresh($);
  if (top === undefined) {
    return;
  }
  void $.prompt.suggest({ text: `/${top.command}` });
  if (top.level === 'alert') {
    $.ui.toast(`${top.icon} ${top.title} · /${top.command}`, { timeoutMs: TOAST_MS });
  }
}

async function snooze($: EngineInterface, notice: Notice): Promise<void> {
  await record($, notice.id, 'snoozed');
  await refresh($);
}

async function syncEstimate($: EngineInterface, notice: Notice): Promise<string | null> {
  if (!actsOn(notice, 'sync')) {
    return null;
  }
  const history = parseHistory(await $.store.get(SYNC_HISTORY_KEY));
  const average = history.length > 1 ? averageMs(history) : null;
  return average === null ? null : `~${formatDuration(average)}`;
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
      isRefreshDue = true;
      await update($, noticeSuppressed, () => true);
      await record($, notice.id, 'acted');
    }
    return next(e);
  });

  on('turn.complete', { isAborted: false }, async ($, e, next) => {
    const result = await next(e);
    if (isRefreshDue && e.agentId === undefined) {
      isRefreshDue = false;
      $.clock.after(0, () => void refresh($));
    }
    return result;
  });

  // Stacks above whatever renders beneath, so other features' rows share the band.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e);
    if (e.props.hasSurvey || (await read($, noticeSuppressed))) {
      return below;
    }
    const [top, ...waiting] = (await read($, notices)).filter((notice) => notice.level !== 'hint');
    if (top === undefined) {
      return below;
    }
    const { Box, Button, Text } = $.ui.resolve(e);
    const estimate = await syncEstimate($, top);
    const facts: NoticeFact[] = [...top.facts, ...(estimate ? [{ text: estimate }] : [])];
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text bold color={LEVEL_COLORS[top.level]}>
            {top.icon}
          </Text>
          <Text bold>{top.title}</Text>
          {facts.map((fact) => (
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
