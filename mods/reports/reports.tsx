import { atom, read, update } from 'claude-code';
import type { EngineInterface, On } from 'claude-code';

import type { ReportRow, SessionReport } from '../types';

import { pathsInCommand } from '../manuals/repo';
import { REPORTS_FEATURE } from '../shared/catalog';
import { cliArgv } from '../shared/cli';
import { bareToolName } from '../sync/phases';

const reportsBand = atom({ plugin: 'agent-kevin', key: 'reportsBand' } as const, null);

const KEY_PREFIX = 'reports:';
const SESSIONS_KEPT = 50;
const ROWS_SHOWN = 5;
const USAGE = 'Usage: /reports, or /reports attach <path>';
const INDEXES = ['reports/index.md', 'reports/pinned.md'];

// Subagents can finish report_write together; one store write at a time keeps both rows.
let writes: Promise<void> = Promise.resolve();
let homeCache: Promise<string | undefined> | undefined;

const isSessionReport = (item: unknown): item is SessionReport =>
  typeof item === 'object' &&
  item !== null &&
  'title' in item &&
  'path' in item &&
  typeof item.title === 'string' &&
  typeof item.path === 'string';

const writtenPath = (text: string | undefined): string | undefined => {
  try {
    const parsed: unknown = JSON.parse(text ?? '');
    return typeof parsed === 'object' && parsed !== null && 'path' in parsed && typeof parsed.path === 'string'
      ? parsed.path
      : undefined;
  } catch {
    return undefined;
  }
};

async function sessionKey($: EngineInterface): Promise<string> {
  return `${KEY_PREFIX}${await $.session.id()}`;
}

async function storedReports($: EngineInterface, key: string): Promise<SessionReport[]> {
  const stored = await $.store.get(key);
  return Array.isArray(stored) ? stored.filter(isSessionReport) : [];
}

const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

const isDocument = (path: string): boolean => path.endsWith('.md') || path.endsWith('.html');

const namesDeliverableFolder = (text: string): boolean =>
  text.includes('/reports/') || text.includes('/projects/') || text.includes('/roadmap.html');

const mayBeReport = (path: string): boolean => isDocument(path) && namesDeliverableFolder(path);

async function home($: EngineInterface): Promise<string | undefined> {
  homeCache ??= $.process
    .run(cliArgv($.plugin.root, $.plugin.name, ['ping']), { cwd: await $.session.root() })
    .then(({ exitCode, stdout }) => {
      const parsed: unknown = exitCode === 0 ? JSON.parse(stdout) : undefined;
      // Outside a home the CLI still names a folder, but says it isn't one.
      return typeof parsed === 'object' &&
        parsed !== null &&
        'ok' in parsed &&
        parsed.ok === true &&
        'home' in parsed &&
        typeof parsed.home === 'string'
        ? parsed.home
        : undefined;
    })
    .catch(() => undefined);
  const found = await homeCache;
  if (found === undefined) {
    homeCache = undefined;
  }
  return found;
}

async function isDeliverable($: EngineInterface, path: string): Promise<boolean> {
  const root = await home($);
  if (root === undefined || !path.startsWith(`${root}/`)) {
    return false;
  }
  const inHome = path.slice(root.length + 1);
  const isReport = inHome.startsWith('reports/') && !INDEXES.includes(inHome);
  const isProjectDocument =
    /^projects\/[^/]+\//.test(inHome) &&
    (path.endsWith('.html') || (fileName(path) !== 'README.md' && !inHome.includes('/tasks/')));
  return isReport || isProjectDocument || inHome === 'roadmap.html';
}

async function rowFor($: EngineInterface, report: SessionReport, root: string): Promise<ReportRow> {
  const page = report.path.replace(/\.md$/, '.html');
  const hasPage =
    page !== report.path &&
    (await $.fs.stat(page).then(
      () => true,
      () => false
    ));
  const shown = hasPage ? page : report.path;
  return { title: report.title, shownPath: shown.startsWith(`${root}/`) ? shown.slice(root.length + 1) : shown };
}

async function rowsFor($: EngineInterface, key: string): Promise<ReportRow[]> {
  const [reports, root] = await Promise.all([storedReports($, key), $.session.root()]);
  const drawn = await Promise.all(reports.map(async (report) => ({ report, row: await rowFor($, report, root) })));
  // A page and its card share a row; the card carries the title report_write gave it.
  const pick = (shownPath: string) => {
    const same = drawn.filter((item) => item.row.shownPath === shownPath);
    return same.find((item) => item.report.path.endsWith('.md')) ?? same[0];
  };
  return drawn.filter((item) => pick(item.row.shownPath) === item).map((item) => item.row);
}

const inQueue = <T,>(task: () => Promise<T>): Promise<T> => {
  const run = writes.then(task);
  writes = run.then(
    () => undefined,
    () => undefined
  );
  return run;
};

const queue = (task: () => Promise<void>): void => {
  inQueue(task).catch(() => undefined);
};

async function record($: EngineInterface, key: string, path: string, title?: string): Promise<void> {
  const reports = await storedReports($, key);
  const report = { path, title: title ?? reports.find((item) => item.path === path)?.title ?? fileName(path) };
  // The store lists keys in insertion order and a set keeps a key's place, so a save moves it to the end.
  await $.store.delete(key);
  await $.store.set(key, [...reports.filter((item) => item.path !== path), report]);
  const sessions = (await $.store.keys()).filter((stored) => stored.startsWith(KEY_PREFIX));
  await Promise.all(sessions.slice(0, -SESSIONS_KEPT).map((stored) => $.store.delete(stored)));
  if ((await read($, reportsBand)) !== null && key === (await sessionKey($))) {
    const rows = await rowsFor($, key);
    await update($, reportsBand, (band) => (band === null ? band : rows));
  }
}

async function attach($: EngineInterface, spelled: string): Promise<string | undefined> {
  const [root, userHome] = await Promise.all([$.session.root(), $.env.get('HOME')]);
  const path = spelled.startsWith('/')
    ? spelled
    : spelled.startsWith('~/') && userHome
      ? `${userHome}/${spelled.slice(2)}`
      : `${root}/${spelled.replace(/^\.\//, '')}`;
  const isFile = await $.fs.stat(path).then(
    (stat) => stat.kind === 'file',
    () => false
  );
  if (!isFile) {
    return `No file at ${spelled}`;
  }
  const key = await sessionKey($);
  queue(() => record($, key, path));
  return undefined;
}

export const registerReports = (on: On): void => {
  on('tool.call', { tool: /__report_write$/ }, async ($, e, next) => {
    const result = await next(e);
    const path = writtenPath(result.text);
    if (bareToolName(e.tool, $.plugin.name) !== 'report_write' || result.isError === true || path === undefined) {
      return result;
    }
    const title = 'title' in e && typeof e.title === 'string' ? e.title : undefined;
    const key = await sessionKey($);
    queue(() => record($, key, path, title));
    return result;
  });

  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    const result = await next(e);
    if (result.deny === undefined && result.isError !== true && mayBeReport(e.file_path)) {
      const key = await sessionKey($);
      queue(async () => {
        if (await isDeliverable($, e.file_path)) {
          await record($, key, e.file_path);
        }
      });
    }
    return result;
  });

  // A shell write leaves no structured trace, so a named path counts once its modified time follows the call's start.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!namesDeliverableFolder(e.command)) {
      return next(e);
    }
    const startedAt = await $.clock.now();
    const result = await next(e);
    if (result.deny === undefined) {
      const key = await sessionKey($);
      queue(async () => {
        const root = await home($);
        const named = root === undefined ? [] : [...new Set(pathsInCommand(e.command, [root]))].filter(isDocument);
        const written = await Promise.all(
          named.map(async (path) => {
            const isWritten =
              (await isDeliverable($, path)) &&
              (await $.fs.stat(path).then(
                (stat) => stat.kind === 'file' && stat.mtimeMs >= startedAt,
                () => false
              ));
            return isWritten ? [path] : [];
          })
        );
        await written.flat().reduce((previous, path) => previous.then(() => record($, key, path)), Promise.resolve());
      });
    }
    return result;
  });

  on('session.start', { isInteractive: true }, async ($, e, next) => {
    await Promise.all(REPORTS_FEATURE.commands.map((command) => $.command.register(command)));
    return next(e);
  });

  // Claude reads the full list; the person sees the latest rows in the band until they dismiss it.
  on('command.run', { command: 'reports' }, async ($, e) => {
    const args = e.args.trim();
    const verb = args.split(/\s+/)[0] ?? '';
    if (verb && verb !== 'attach') {
      return { text: USAGE };
    }
    if (verb === 'attach') {
      const spelled = args.slice(verb.length).trim();
      if (!spelled) {
        return { text: USAGE };
      }
      const failure = await attach($, spelled);
      if (failure !== undefined) {
        return { text: failure };
      }
    }
    const key = await sessionKey($);
    // Read in the queue, so a save landing meanwhile either comes first or finds the band open.
    const rows = await inQueue(async () => {
      const found = await rowsFor($, key);
      if (found.length) {
        await update($, reportsBand, () => found);
      }
      return found;
    });
    if (rows.length === 0) {
      return { text: 'No reports in this conversation yet.' };
    }
    return {
      context: [['Reports in this conversation:', ...rows.map((row) => `- ${row.shownPath} · ${row.title}`)].join('\n')]
    };
  });

  // A /clear or a resume starts another conversation in the same process.
  on('session.end', { reason: ['clear', 'resume'] }, async ($, e, next) => {
    await update($, reportsBand, () => null);
    return next(e);
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e);
    const rows = await read($, reportsBand);
    if (rows === null || e.props.hasSurvey) {
      return below;
    }
    const { Box, Button, Text } = $.ui.resolve(e);
    const hidden = rows.length - ROWS_SHOWN;
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text bold>📎 Reports</Text>
          <Text dimColor>{`· ${rows.length} in this conversation`}</Text>
          <Box marginLeft={2}>
            <Button key="reports:dismiss" dimColor label="Dismiss" onPress={() => update($, reportsBand, () => null)} />
          </Box>
        </Box>
        {hidden > 0 ? <Text dimColor>{`   +${hidden} earlier`}</Text> : null}
        {rows.slice(-ROWS_SHOWN).map((row) => (
          <Box key={row.shownPath} paddingLeft={3}>
            <Box flexShrink={0}>
              <Text>{row.shownPath}</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1} marginLeft={2}>
              <Text dimColor wrap="truncate-end">
                {row.title}
              </Text>
            </Box>
          </Box>
        ))}
        {below}
      </Box>
    );
  });
};
