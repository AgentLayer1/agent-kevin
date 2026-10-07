import { atom, read, update } from 'claude-code';
import type { EngineInterface, On, Timer } from 'claude-code';

import { cliArgv } from '../shared/cli';
import type { SyncSnapshot } from '../types';
import { PHASES, bareToolName, classify } from './phases';
import {
  actionNotes,
  appendHistory,
  averageMs,
  finish,
  isOver,
  formatDuration,
  markWaiting,
  parseBrain,
  parseCompile,
  parseHistory,
  parseTasks,
  progressOf,
  recordCall,
  remeasured,
  startRun,
  statsInstruction,
  statsPayload,
  toHistory
} from './stats';

const syncRun = atom({ plugin: 'agent-kevin', key: 'syncRun' } as const, null);
// Bumped every second while a run is live; only the band reads it, so only the band redraws.
const syncTick = atom({ plugin: 'agent-kevin', key: 'syncTick' } as const, 0);

const HISTORY_KEY = 'sync-history';
const STATS_TOOL = 'sync_stats';
const SYNC_SKILL = /(^|:)sync$/;
const TICK_MS = 1000;

const LOOKS = {
  running: { icon: '⟳', color: 'cyan', status: 'running' },
  waiting: { icon: '⏸', color: 'yellow', status: 'waiting on you' },
  done: { icon: '✓', color: 'green', status: 'done' },
  stopped: { icon: '■', color: 'red', status: 'stopped' }
} as const;

// Module state: a reload drops the timer and the next run starts a new one.
let ticker: Timer | undefined;

async function runQuiet($: EngineInterface, argv: readonly string[]): Promise<string> {
  const { exitCode, stdout } = await $.process.run(argv, { cwd: await $.session.root() });
  return exitCode === 0 ? stdout : '';
}

async function measureCompile($: EngineInterface) {
  return parseCompile(await runQuiet($, cliArgv($.plugin.root, $.plugin.name, ['compile', 'status'])));
}

async function snapshot($: EngineInterface): Promise<SyncSnapshot> {
  const [compile, tasks, brain] = await Promise.all([
    measureCompile($),
    runQuiet($, cliArgv($.plugin.root, $.plugin.name, ['task', 'scan'])),
    runQuiet($, ['bun', `${$.plugin.root}/skills/self-review/scripts/brain-audit.ts`])
  ]);
  return { compile, tasks: parseTasks(tasks), brain: parseBrain(brain) };
}

/**
 * Re-measures in the background so the counters move during the run; a late answer after the
 * run ended is dropped.
 */
async function refresh($: EngineInterface, fresh: Promise<Partial<SyncSnapshot>>): Promise<void> {
  const measured = await fresh.catch(() => ({}));
  await update($, syncRun, (run) => (run && !isOver(run) ? remeasured(run, measured) : run));
}

async function history($: EngineInterface) {
  return parseHistory(await $.store.get(HISTORY_KEY));
}

export const registerSync = (on: On): void => {
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    await $.tool.register({
      name: STATS_TOOL,
      description:
        "Counted numbers for the sync that is running: compile backlog, task health and brain counts measured at the run's start and now, actions tallied from tool results, and phase timings. Call once before writing sync's output block.",
      inputSchema: { type: 'object', properties: {} }
    });
    return next(e);
  });

  on('skill.prompt', { skill: SYNC_SKILL }, async ($, e, next) => {
    const result = await next(e);
    const now = await $.clock.now();
    const before = await snapshot($).catch(() => null);
    await update($, syncRun, () => startRun(now, before));
    ticker?.cancel();
    ticker = $.clock.every(TICK_MS, () => void update($, syncTick, (tick) => tick + 1));
    const tools = await $.tool.list();
    const statsTool = tools.find((tool) => tool.name.endsWith(`__${STATS_TOOL}`));
    return statsTool ? { text: result.text + statsInstruction(statsTool.name) } : result;
  });

  on('tool.call', async ($, e, next) => {
    const before = await read($, syncRun);
    if (before === null || isOver(before) || e.agentId !== undefined) {
      return next(e);
    }
    const phase = classify({ tool: e.tool, input: e }, $.plugin.name);
    if (e.tool === 'AskUserQuestion') {
      const asked = await $.clock.now();
      await update($, syncRun, (run) => (run ? markWaiting(run, phase, asked) : run));
    }
    const result = await next(e);
    const now = await $.clock.now();
    const call = {
      phase,
      name: bareToolName(e.tool, $.plugin.name),
      resultText: result.text ?? '',
      isError: result.isError === true
    };
    await update($, syncRun, (run) => (run ? recordCall(run, call, now) : run));
    if (call.phase !== undefined && call.phase > before.phase) {
      $.clock.after(0, () => void refresh($, snapshot($)));
    } else if (call.name === 'compile_write') {
      $.clock.after(
        0,
        () =>
          void refresh(
            $,
            measureCompile($).then((compile) => ({ compile }))
          )
      );
    }
    return result;
  });

  on('tool.call', { tool: /__sync_stats$/ }, async ($) => {
    const run = await read($, syncRun);
    if (run === null) {
      return { result: 'No sync is running in this session.' };
    }
    const after = await snapshot($).catch(() => null);
    await update($, syncRun, (current) => (current ? { ...current, after } : current));
    const now = await $.clock.now();
    // A tool result is text or content blocks, never an object.
    return { result: JSON.stringify(statsPayload({ ...run, after }, now, await history($))) };
  });

  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    const run = await read($, syncRun);
    if (run === null || isOver(run) || e.agentId !== undefined) {
      return result;
    }
    ticker?.cancel();
    ticker = undefined;
    const now = await $.clock.now();
    const ended = finish(run, now, await snapshot($).catch(() => null), e.isAborted);
    await update($, syncRun, () => ended);
    // A stopped run would drag the average down.
    if (!e.isAborted) {
      await $.store.set(HISTORY_KEY, appendHistory(await history($), toHistory(ended)));
    }
    return result;
  });

  on('prompt.submit', async ($, e, next) => {
    const run = await read($, syncRun);
    if (run && isOver(run)) {
      await update($, syncRun, () => null);
    }
    return next(e);
  });

  // Stacks above whatever renders beneath, so other features' rows share the band.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e);
    const run = await read($, syncRun);
    if (run === null || e.props.hasSurvey) {
      return below;
    }
    const { Box, Text } = $.ui.resolve(e);
    const now = await $.clock.now();
    const look = LOOKS[run.status];
    const isEnded = isOver(run);
    const isComplete = run.status === 'done';
    await read($, syncTick);
    const past = isComplete ? await history($) : [];
    const average = past.length > 1 ? averageMs(past) : null;
    const elapsed = formatDuration((run.endedAt ?? now) - run.startedAt);
    const notes = actionNotes(run.actions);

    const header = (
      <Box>
        <Text color={look.color}>{look.icon} </Text>
        <Text bold>sync</Text>
        <Text dimColor>
          {' '}
          · {look.status} · {elapsed}
          {average === null ? '' : ` (avg ${formatDuration(average)})`}
        </Text>
      </Box>
    );

    const rail = (
      <Box>
        {PHASES.map((phase, index) => (
          <Box key={phase.id}>
            {index > 0 ? <Text dimColor>─</Text> : null}
            {isComplete || index < run.phase ? (
              <Text color="green">●</Text>
            ) : index === run.phase ? (
              <Text color={look.color}>◉</Text>
            ) : (
              <Text dimColor>○</Text>
            )}
          </Box>
        ))}
        {!isComplete && PHASES[run.phase] ? (
          <Box>
            <Text>
              {'  '}
              {PHASES[run.phase]?.id}{' '}
            </Text>
            <Text dimColor>{`${run.phase + 1}/${PHASES.length}`}</Text>
          </Box>
        ) : null}
      </Box>
    );

    const counters = (
      <Box gap={3}>
        {progressOf(run).map((item) => (
          <Box key={item.label}>
            <Text dimColor>{item.label} </Text>
            <Text color={item.cleared && item.cleared === item.total ? 'green' : undefined}>
              {item.cleared}/{item.total}
            </Text>
            {item.grew ? <Text color="red"> +{item.grew}</Text> : null}
          </Box>
        ))}
        {notes.length ? <Text dimColor>· {notes.join('  ')}</Text> : null}
      </Box>
    );

    return isEnded ? (
      <Box flexDirection="column">
        <Box gap={2}>
          {header}
          {rail}
          {counters}
        </Box>
        {below}
      </Box>
    ) : (
      <Box flexDirection="column">
        {header}
        <Box paddingLeft={2}>{rail}</Box>
        <Box paddingLeft={2}>{counters}</Box>
        {below}
      </Box>
    );
  });
};
