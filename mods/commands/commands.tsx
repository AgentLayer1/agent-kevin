import { atom, read, update } from 'claude-code';
import type { EngineInterface, On } from 'claude-code';

import type { AgendaItem, TodayView } from '../types';

import { cliArgv, cliError } from '../shared/cli';
import type { TaskFrontmatter } from './today';
import { STALE_SYNC_HOURS, buildToday, formatAge, parseEmoji, summarize } from './today';

const todayViews = atom({ plugin: 'agent-kevin', key: 'todayViews' } as const, {});

const VIEWS_KEPT = 10;
const PRIORITY_COLORS: Record<string, string> = { P0: 'red', P1: 'yellow' };

const COMMANDS = [
  {
    name: 'capture',
    description: 'Drop a thought into the knowledge inbox (no Claude turn)',
    argumentHint: '<text>',
    immediate: true
  },
  {
    name: 'lesson',
    description: 'Log a correction to the feedback log (no Claude turn)',
    argumentHint: '<text>',
    immediate: true
  },
  { name: 'done', description: 'Close a task by id (no Claude turn)', argumentHint: '<task-id>', immediate: true },
  { name: 'today', description: "Overdue work, what's due today and the last sync (no Claude turn)" }
] as const;

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
    runCli($, ['task', 'query']).then((text) => JSON.parse(text) as TaskFrontmatter[]),
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
    await Promise.all(COMMANDS.map((command) => $.command.register(command)));
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
    return { text: `Closed ${id}` };
  });

  on('command.run', { command: 'today' }, async ($) => {
    const view = await todayView($).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
    if (typeof view === 'string') {
      return { text: `Couldn't read today's state: ${view}` };
    }
    const text = summarize(view);
    await update($, todayViews, (views) =>
      Object.fromEntries([...Object.entries(views), [text, view]].slice(-VIEWS_KEPT))
    );
    return { text };
  });

  // Claude reads the one-line summary; the transcript draws the agenda stored under it.
  on('ui.render', { component: 'CommandOutput', props: { command: 'today' } }, async ($, e, next) => {
    const view = (await read($, todayViews))[e.props.text];
    if (view === undefined) {
      return next(e);
    }
    const { Box, Text } = $.ui.resolve(e);
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
        <Box>
          <Text>{view.emoji} </Text>
          <Text bold>Today</Text>
          <Text dimColor>
            {' '}
            · {view.dateLabel} · {view.hijriLabel}
          </Text>
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
      </Box>
    );
  });
};
