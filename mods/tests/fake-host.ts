import { mock } from 'claude-code/testing';
import type { Engine, MockClock } from 'claude-code/testing';
import type { FsStat, On, ProcessRunResult } from 'claude-code';

import type { Notice } from '../types';

export const HOME = '/fixture/home';
export const USER_HOME = '/fixture/user';
export const CODE = '/fixture/code';
/**
 * How long the fake person takes to answer a question.
 */
export const QUESTION_MS = 30_000;
export const NOW = Date.parse('2026-03-10T09:00:00+08:00');

export const TASKS = [
  { id: 'ac-001', title: 'Licence fixture', status: 'active', priority: 'P1', due: '2026-03-01' },
  { id: 'ac-002', title: 'Due today fixture', status: 'open', priority: 'P2', due: '2026-03-10' },
  { id: 'ac-003', title: 'Closed fixture', status: 'done', priority: 'P0', due: '2026-02-01' },
  { id: 'ac-005', title: 'Urgent fixture', status: 'open', priority: 'P0', due: '2026-03-08' }
];

/**
 * A fake machine: files and folders by absolute path, and the CLI's answers, mutable mid-test.
 */
export interface FakeMachine {
  files: Record<string, string>;
  folders: string[];
  compilePending: { sessions: number; feedback: number; inbox: number };
  taskScan: { overdue: number; stale: number; dueSoon: number };
  brainStale: number;
  store: Map<string, unknown>;
  argv: string[][];
  cwd: (string | undefined)[];
  toolText: Record<string, string>;
  fsCalls: string[];
  notices: Notice[];
  toasts: string[];
  suggestions: string[];
  commands: string[];
}

export const machine = (overrides: Partial<FakeMachine> = {}): FakeMachine => ({
  files: {
    [`${HOME}/IDENTITY.md`]: '- **Name:** Ada\n- **Emoji:** 🦊\n',
    [`${HOME}/.data/cadence.json`]: JSON.stringify({ sync: '2026-03-06T09:00:00+08:00' })
  },
  folders: [],
  compilePending: { sessions: 3, feedback: 1, inbox: 0 },
  taskScan: { overdue: 7, stale: 12, dueSoon: 2 },
  brainStale: 12,
  store: new Map(),
  argv: [],
  cwd: [],
  toolText: {},
  fsCalls: [],
  notices: [],
  toasts: [],
  suggestions: [],
  commands: [],
  ...overrides
});

const ran = (exitCode: number, stdout: string, stderr = ''): { value: ProcessRunResult } => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false }
});

const stat = (kind: FsStat['kind']): { value: FsStat } => ({ value: { kind, size: 0, mtimeMs: 0, isLink: false } });

// A real filesystem resolves '.' and '..' segments, so the fake does too.
const resolved = (path: string): string =>
  `/${path
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.')
    .reduce<string[]>((parts, segment) => (segment === '..' ? parts.slice(0, -1) : [...parts, segment]), [])
    .join('/')}`;

const items = (length: number): string[] => Array.from({ length }, (_unused, index) => `item-${index}`);

const cliAnswer = (host: FakeMachine, args: string): { value: ProcessRunResult } => {
  if (args === 'ping') {
    return ran(0, JSON.stringify({ ok: true, home: HOME, data: `${HOME}/.data`, timezone: 'Asia/Kuala_Lumpur' }));
  }
  if (args === 'task query') {
    return ran(0, JSON.stringify(TASKS));
  }
  if (args === 'compile status') {
    return ran(0, JSON.stringify({ pending: host.compilePending }));
  }
  if (args === 'task scan') {
    return ran(
      0,
      JSON.stringify({
        overdue: items(host.taskScan.overdue),
        stale: items(host.taskScan.stale),
        dueSoon: items(host.taskScan.dueSoon)
      })
    );
  }
  if (args === 'notices') {
    return ran(0, JSON.stringify(host.notices));
  }
  if (args.startsWith('capture')) {
    return ran(0, JSON.stringify({ ok: true, relPath: 'knowledge/raw/inbox/fixture.md', duplicate: false }));
  }
  return ran(0, JSON.stringify({ ok: true }));
};

/**
 * Stands in for the host beneath the plugin: the plugin CLI, settings, files, clock and store.
 */
export interface FakeHost extends FakeMachine {
  clock: MockClock;
}

export const fakeHost = (on: On, host: FakeMachine = machine()): FakeHost => {
  const clock = mock.clock(on, { now: NOW });
  on('session.root', () => ({ value: HOME }));
  on('env.get', () => ({ value: USER_HOME }));
  on('settings.read', () => ({ value: { permissions: { additionalDirectories: [CODE, '~/granted'] } } }));
  on('process.run', (_$, e) => {
    host.argv.push([...e.argv]);
    host.cwd.push(e.init?.cwd);
    if (e.argv[1]?.endsWith('/brain-audit.ts')) {
      return ran(0, JSON.stringify({ counts: { staleTasks: host.brainStale, oldestWaiting: '2026-01-01' } }));
    }
    return cliAnswer(host, e.argv.slice(2).join(' '));
  });
  on('fs.read', (_$, e) => {
    host.fsCalls.push(e.path);
    const text = host.files[resolved(e.path)];
    if (text === undefined) {
      throw new Error(`ENOENT ${e.path}`);
    }
    return { value: text };
  });
  on('fs.stat', (_$, e) => {
    host.fsCalls.push(e.path);
    if (host.folders.includes(resolved(e.path))) {
      return stat('dir');
    }
    if (host.files[resolved(e.path)] !== undefined) {
      return stat('file');
    }
    throw new Error(`ENOENT ${e.path}`);
  });
  on('store.get', (_$, e) => ({ value: host.store.get(e.key) }));
  on('store.set', (_$, e) => {
    host.store.set(e.key, e.value);
    return { value: undefined };
  });
  on('tool.list', () => ({ value: [{ name: 'mcp__agent-kevin__sync_stats', description: 'stats', mcp: true }] }));
  on('tool.call', async (_$, e) => {
    if (e.tool === 'AskUserQuestion') {
      await clock.sleep(QUESTION_MS);
    }
    return { result: 'ok', text: host.toolText[e.tool] ?? '{}' };
  });
  on('skill.prompt', (_$, e) => ({ text: e.text }));
  on('turn.complete', () => ({ text: '', reason: 'answer' as const }));
  on('session.compact', (_$, e) => ({ messages: e.messages }));
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }));
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('command.register', (_$, e) => ({ value: { command: e.name } }));
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }));
  on('ui.toast', (_$, e) => {
    host.toasts.push(e.text);
    return { value: undefined };
  });
  on('prompt.suggest', (_$, e) => {
    host.suggestions.push(e.text);
    return { isShown: true };
  });
  on('command.run', (_$, e) => {
    host.commands.push(e.command);
    return {};
  });
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box' as const }));
  on('ui.render', { component: 'CommandOutput' }, () => ({ type: 'Box' as const, props: { key: 'plain-row' } }));
  return Object.assign(host, { clock });
};

export const run = ($: Engine, command: string, args = '') =>
  $.command.run({
    command,
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 }
  });

export const BAND_PROPS = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 12,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 12 },
  view: {}
};
