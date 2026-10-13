import { atom, read, update } from 'claude-code';
import type { EngineInterface, On, UiPressArgument } from 'claude-code';

import type { AgendaItem, TodayView } from '../types';

import { COMMANDS_FEATURE } from '../shared/catalog';
import { cliArgv, cliError } from '../shared/cli';
import { doneSuggestions, isDoneArgument } from './done';
import type { TaskFrontmatter } from './today';
import { STALE_SYNC_HOURS, buildToday, formatAge, parseEmoji, summarize } from './today';

const todayBand = atom({ plugin: 'agent-kevin', key: 'todayBand' } as const, null);
const sessionBand = atom({ plugin: 'agent-kevin', key: 'sessionBand' } as const, null);
const TASKS_FRESH_MS = 60_000;
const PRIORITY_COLORS: Record<string, string> = { P0: 'red', P1: 'yellow' };

// The read itself is cached, so keystrokes that land before it finishes share it.
let doneTasks: { readAt: number; tasks: Promise<TaskFrontmatter[]> } | undefined;

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

async function readTasks($: EngineInterface): Promise<TaskFrontmatter[]> {
  return JSON.parse(await runCli($, ['task', 'query'])) as TaskFrontmatter[];
}

async function captureAs($: EngineInterface, kind: 'inbox' | 'feedback', text: string) {
  if (!text.trim()) {
    return { text: `Usage: /${kind === 'inbox' ? 'capture' : 'lesson'} <text>` };
  }
  const result = JSON.parse(await runCli($, ['capture', text, `--kind=${kind}`])) as {
    relPath: string;
    duplicate: boolean;
  };
  return { text: result.duplicate ? `Already captured: ${result.relPath}` : `Saved to ${result.relPath}` };
}

async function todayView($: EngineInterface): Promise<TodayView> {
  const { home, data, timezone } = JSON.parse(await runCli($, ['ping'])) as {
    home: string;
    data: string;
    timezone: string;
  };
  const [tasks, syncedAt, identityText, now] = await Promise.all([
    readTasks($),
    $.fs
      .read(`${data}/cadence.json`)
      .then((text) => (JSON.parse(text) as { sync?: string }).sync)
      .catch(() => undefined),
    $.fs.read(`${home}/IDENTITY.md`).catch(() => ''),
    $.clock.now()
  ]);
  return buildToday({ emoji: parseEmoji(identityText), timezone, tasks, syncedAt, now });
}

export const registerCommands = (on: On): void => {
  on('session.start', async ($, e, next) => {
    await Promise.all(COMMANDS_FEATURE.commands.map((command) => $.command.register(command)));
    return next(e);
  });

  on('command.run', { command: 'capture' }, ($, e) => captureAs($, 'inbox', e.args));

  on('command.run', { command: 'lesson' }, ($, e) => captureAs($, 'feedback', e.args));

  on('command.run', { command: 'done' }, async ($, e) => {
    const id = e.args.trim();
    if (!id) {
      return { text: 'Usage: /done <task-id>' };
    }
    await runCli($, ['task', 'close', id]);
    doneTasks = undefined;
    return { text: `Closed ${id}` };
  });

  on('prompt.autocomplete', async ($, e, next) => {
    if (!isDoneArgument(e.text.slice(0, e.start))) {
      return next(e);
    }
    const [result, now] = await Promise.all([next(e), $.clock.now()]);
    if (doneTasks === undefined || now - doneTasks.readAt > TASKS_FRESH_MS) {
      doneTasks = { readAt: now, tasks: readTasks($).catch((): TaskFrontmatter[] => []) };
    }
    return { suggestions: [...result.suggestions, ...doneSuggestions(await doneTasks.tasks, e.token)] };
  });

  // Claude reads the one-line summary; the person sees the agenda in the band until they dismiss it.
  on('command.run', { command: 'today' }, async ($) => {
    const view = await todayView($).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
    if (typeof view === 'string') {
      return { text: `Couldn't read today's state: ${view}` };
    }
    await update($, todayBand, () => view);
    return { context: [summarize(view)] };
  });

  on('command.run', { command: 'session' }, async ($) => {
    const id = await $.session.id();
    await update($, sessionBand, () => id);
    return { context: [`Session id: ${id}`] };
  });

  // A /clear or a resume starts another conversation in the same process.
  on('session.end', { reason: ['clear', 'resume'] }, async ($, e, next) => {
    await Promise.all([update($, todayBand, () => null), update($, sessionBand, () => null)]);
    return next(e);
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e);
    const id = await read($, sessionBand);
    if (id === null || e.props.hasSurvey) {
      return below;
    }
    const { Box, Button, Text } = $.ui.resolve(e);
    const copy = async (press: UiPressArgument) => {
      const copied = await $.ui.copy({ text: id, surface: press.surface });
      $.ui.toast(copied.isCopied ? 'Session id copied' : `Couldn't copy the session id (${copied.reason})`);
    };
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text bold>Session</Text>
          <Text>{id}</Text>
          <Box marginLeft={2} gap={2}>
            <Button key="session:copy" label="Copy" onPress={copy} />
            <Button key="session:dismiss" dimColor label="Dismiss" onPress={() => update($, sessionBand, () => null)} />
          </Box>
        </Box>
        {below}
      </Box>
    );
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e);
    const view = await read($, todayBand);
    if (view === null || e.props.hasSurvey) {
      return below;
    }
    const { Box, Button, Text } = $.ui.resolve(e);
    const isStale = view.syncAgeHours === null || view.syncAgeHours >= STALE_SYNC_HOURS;
    const idWidth = Math.max(0, ...[...view.overdue, ...view.dueToday].map((item) => item.id.length));
    const row = (item: AgendaItem, isLate: boolean) => (
      <Box key={item.id} paddingLeft={3}>
        <Text dimColor>▸ </Text>
        <Text color={PRIORITY_COLORS[item.priority]} dimColor={!PRIORITY_COLORS[item.priority]}>
          {item.priority.padEnd(4)}
        </Text>
        <Text dimColor>{item.id.padEnd(idWidth + 2)}</Text>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">{item.title}</Text>
        </Box>
        {isLate ? <Text color="red">{`  ${item.daysLate}d late`}</Text> : null}
      </Box>
    );
    const section = (title: string, items: readonly AgendaItem[], isLate: boolean) =>
      items.length ? (
        <Box key={title} flexDirection="column" marginTop={1}>
          <Box paddingLeft={2}>
            <Text bold>{title}</Text>
            <Text dimColor>{`  ${items.length}`}</Text>
          </Box>
          {items.map((item) => row(item, isLate))}
        </Box>
      ) : null;
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text>{view.emoji}</Text>
          <Text bold>Today</Text>
          <Text dimColor>
            · {view.dateLabel} · {view.hijriLabel}
          </Text>
          <Box marginLeft={2}>
            <Button key="today:dismiss" dimColor label="Dismiss" onPress={() => update($, todayBand, () => null)} />
          </Box>
        </Box>
        {section('Overdue', view.overdue, true)}
        {section('Due today', view.dueToday, false)}
        {view.overdue.length + view.dueToday.length === 0 ? (
          <Box marginTop={1} paddingLeft={2}>
            <Text color="green">✓ nothing overdue or due today</Text>
          </Box>
        ) : null}
        <Box marginTop={1} paddingLeft={2}>
          <Text color={isStale ? 'yellow' : undefined} dimColor={!isStale}>
            ⟳ {view.syncAgeHours === null ? 'never synced' : `last sync ${formatAge(view.syncAgeHours)}`}
          </Text>
        </Box>
        {below}
      </Box>
    );
  });
};
