import { atom, read, update } from 'claude-code';
import type { EngineInterface, On } from 'claude-code';

import type { TaskCard } from '../types';

import { TASKS_FEATURE } from '../shared/catalog';
import { cliArgv, cliError } from '../shared/cli';
import { PRIORITY_COLORS } from '../shared/priority';
import { MAY_HOLD_ID, linkTaskIds } from './link';
import type { TaskFile, TaskRow, Verb } from './task';
import {
  STATUS_LOOK,
  USAGE,
  VERBS,
  buildCard,
  cardSummary,
  clip,
  completionSlot,
  fileHref,
  isLive,
  parseTaskArgs,
  progressBar,
  taskSuggestions,
  verbSuggestions
} from './task';

const taskCard = atom({ plugin: 'agent-kevin', key: 'taskCard' } as const, null);
const TASKS_FRESH_MS = 60_000;

// Autocomplete and reply links share one read a minute; reply links draw from the last list while the next loads.
let cache: { readAt: number; tasks: Promise<readonly TaskRow[]> } | undefined;
let known: readonly TaskRow[] = [];
let hrefs: ReadonlyMap<string, string> = new Map();

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

async function tasksAt($: EngineInterface): Promise<readonly TaskRow[]> {
  const now = await $.clock.now();
  if (cache === undefined || now - cache.readAt > TASKS_FRESH_MS) {
    const tasks = runCli($, ['task', 'query']).then(
      (stdout) => {
        known = JSON.parse(stdout) as TaskRow[];
        hrefs = new Map(known.flatMap((task) => (task.filePath ? [[task.id, fileHref(task.filePath)] as const] : [])));
        return known;
      },
      () => known
    );
    cache = { readAt: now, tasks };
  }
  return cache.tasks;
}

async function readTask($: EngineInterface, id: string): Promise<TaskFile | null> {
  return runCli($, ['task', 'get', id]).then(
    (stdout) => JSON.parse(stdout) as TaskFile,
    () => null
  );
}

async function showCard($: EngineInterface, task: TaskFile): Promise<TaskCard> {
  const card = buildCard(task, await $.clock.now());
  await update($, taskCard, () => card);
  return card;
}

/**
 * Applies the verb and redraws the card when it shows that task; resolves the CLI's error, if any.
 */
async function act($: EngineInterface, id: string, verb: Verb): Promise<string | null> {
  const error = await runCli($, VERBS[verb].cli(id)).then(
    () => null,
    (failure: unknown) => (failure instanceof Error ? failure.message : String(failure))
  );
  if (error !== null) {
    return error;
  }
  cache = undefined;
  const updated = (await read($, taskCard))?.id === id ? await readTask($, id) : null;
  if (updated !== null) {
    await showCard($, updated);
  }
  return null;
}

export const registerTasks = (on: On): void => {
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    await Promise.all(TASKS_FEATURE.commands.map((command) => $.command.register(command)));
    void tasksAt($);
    return next(e);
  });

  // Claude reads one line; the person sees the card above the prompt until they dismiss it.
  on('command.run', { command: 'task' }, async ($, e) => {
    const args = parseTaskArgs(e.args);
    if (args.kind === 'usage') {
      return { text: USAGE };
    }
    if (args.kind === 'unknown-verb') {
      return { text: `Unknown action "${args.verb}". ${USAGE}` };
    }
    const task = await readTask($, args.id);
    if (task === null) {
      return { text: `No task ${args.id}` };
    }
    if (args.verb === undefined) {
      return { context: [cardSummary(await showCard($, task))] };
    }
    if (!isLive(task.frontmatter.status)) {
      return { text: `${args.id} is already ${task.frontmatter.status}` };
    }
    const error = await act($, args.id, args.verb);
    return { text: error === null ? `${VERBS[args.verb].past} ${args.id}` : `Couldn't update ${args.id}: ${error}` };
  });

  on('prompt.autocomplete', async ($, e, next) => {
    const slot = completionSlot(e.text.slice(0, e.start));
    if (slot === null) {
      return next(e);
    }
    const [result, tasks] = await Promise.all([next(e), tasksAt($)]);
    const added =
      slot.kind === 'id'
        ? taskSuggestions(tasks, e.token)
        : verbSuggestions(
            tasks.find((task) => task.id === slot.id),
            e.token
          );
    return { suggestions: [...result.suggestions, ...added] };
  });

  // Draws the ids as links and leaves the stored reply alone; a render never waits on the CLI.
  // Terminal only: the other surfaces draw a file: link as plain text.
  on('ui.render', { component: 'AssistantMessage', surface: 'terminal' }, async ($, e, next) => {
    if (!MAY_HOLD_ID.test(e.props.text)) {
      return next(e);
    }
    void tasksAt($);
    const text = linkTaskIds(e.props.text, hrefs);
    return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } });
  });

  // A /clear or a resume starts another conversation in the same process.
  on('session.end', { reason: ['clear', 'resume'] }, async ($, e, next) => {
    await update($, taskCard, () => null);
    return next(e);
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e);
    const card = await read($, taskCard);
    if (card === null || e.props.hasSurvey) {
      return below;
    }
    const { Box, Button, Link, Text } = $.ui.resolve(e);
    const indent = card.id.length + 1;
    const look = STATUS_LOOK[card.status] ?? { glyph: '·' };
    const isLate = (card.due?.daysLate ?? 0) > 0;
    const facts = [
      <Text color={look.color} dimColor={!look.color}>{`${look.glyph} ${card.status}`}</Text>,
      card.priority ? (
        <Text color={PRIORITY_COLORS[card.priority]} dimColor={!PRIORITY_COLORS[card.priority]}>
          {card.priority}
        </Text>
      ) : null,
      card.project ? <Text dimColor>{card.project}</Text> : null,
      card.due ? (
        <Text color={isLate ? 'red' : undefined} dimColor={!isLate}>
          {isLate ? `${card.due.label} · ${card.due.daysLate}d late` : card.due.label}
        </Text>
      ) : null
    ].filter((fact) => fact !== null);
    const close = async () => {
      const error = await act($, card.id, 'done');
      if (error !== null) {
        $.ui.toast(`Couldn't close ${card.id}: ${error}`);
      }
    };
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text dimColor>{card.id}</Text>
          <Box flexGrow={1} flexShrink={1}>
            <Text bold>{card.title}</Text>
          </Box>
          <Box marginLeft={2} flexShrink={0}>
            <Button key="task:dismiss" dimColor label="Dismiss" onPress={() => update($, taskCard, () => null)} />
          </Box>
        </Box>
        <Box paddingLeft={indent} marginTop={1} gap={1}>
          {facts.flatMap((fact, index) => (index === 0 ? [fact] : [<Text dimColor>·</Text>, fact]))}
        </Box>
        {card.summary ? (
          <Box paddingLeft={indent} marginTop={1}>
            <Text>{clip(card.summary, Math.max(40, (e.props.bodyColumns - indent) * 2))}</Text>
          </Box>
        ) : null}
        {card.checklist ? (
          <Box paddingLeft={indent} marginTop={1} gap={2}>
            <Text color="cyan">{progressBar(card.checklist.done, card.checklist.total)}</Text>
            <Text dimColor>{`${card.checklist.done} of ${card.checklist.total}`}</Text>
          </Box>
        ) : null}
        <Box paddingLeft={indent} marginTop={1} gap={3}>
          {e.surface === 'terminal' ? (
            <Text>
              <Link href={card.href}>Open ↗</Link>
            </Text>
          ) : null}
          {isLive(card.status) ? <Button key="task:done" variant="primary" label="Done" onPress={close} /> : null}
        </Box>
        {below}
      </Box>
    );
  });
};
