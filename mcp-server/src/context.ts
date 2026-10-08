/**
 * Per-session DYNAMIC context preamble.
 *
 * Static identity (SOUL, IDENTITY, USER, the AGENTS.md manual) and knowledge
 * indexes are loaded natively by Claude Code via `@-imports` inside
 * `<HOME>/.claude/CLAUDE.md` — no hook involvement needed when CC opens in (or
 * under) AGENT_HOME.
 *
 * This hook only injects what CC can't know from files alone: today's date in
 * the user's timezone, the tail of yesterday's session log for continuity, and
 * recent git activity. Caps at ~10KB per CC's hook limit, but usually fits in
 * a few KB.
 */
import {
  CONTEXT,
  extraGitRepos,
  FILES,
  FOLDERS,
  HOME_TIMEZONE,
  operatingManualPath,
  PLUGIN_NAME,
  PLUGIN_VERSION,
  TIMEZONE
} from '@/config';
import { followMove, historyStatus, restorePointer } from '@/home/history';
import { checkHosts, hostIssues, requiredHosts } from '@/hosts';
import type { Notice, NoticeFact, NoticeLevel } from '@/notices/notices';
import { collectNotices } from '@/notices/notices';
import { agentDisplayName } from '@/shared/agent-name';
import { ANSI, paint } from '@/shared/banner';
import { readCadence } from '@/shared/cadence';
import { log as baseLog } from '@/shared/log';
import { LEGACY_RUNTIME_DIR, RUNTIME_DIR } from '@/shared/naming';
import { isInside } from '@/shared/paths';
import { countOf } from '@/shared/utils';
import { statusLineDrift } from '@/statusline/setting';
import { getUpgradeStatus } from '@/version';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { FIRST_SESSION_HEADER_RE, SESSION_BLOCK_SEPARATOR_RE, TRAILING_SEPARATOR_RE } from './knowledge/session-format';

const log = baseLog.session.with('context');

export interface ManifestEntry {
  label: string;
  /** `off` is a choice the operator made (history not turned on), so it never raises the issue flag. */
  status: 'loaded' | 'missing' | 'unavailable' | 'off';
  bytes: number;
  note?: string;
}

function recentGitLog(cwd: string): string | null {
  try {
    const output = execSync(`git log --oneline --format="%h %s (%ar)" -${CONTEXT.MAX_GIT_LOG_COMMITS}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 5_000
    }).trim();
    return output || null;
  } catch {
    return null;
  }
}

export function findLastSessionBlockStart(content: string): number {
  let lastSeparator = -1;
  for (const match of content.matchAll(SESSION_BLOCK_SEPARATOR_RE)) {
    lastSeparator = (match.index ?? 0) + match[0].length;
  }
  if (lastSeparator !== -1) return lastSeparator;
  const firstHeader = content.match(FIRST_SESSION_HEADER_RE);
  return firstHeader && firstHeader.index !== undefined ? firstHeader.index : -1;
}

interface TailResult {
  content: string | null;
  entry: ManifestEntry;
}

/**
 * The raw tail is role-labelled dialogue (`**User:** … **Assistant:** …`),
 * which the model pattern-matches as live conversation. Fencing it as quoted
 * data + an explicit "archived, do not respond" preamble keeps it read as
 * memory, not as turns in progress.
 */
const TAIL_PREAMBLE =
  'Archived transcript excerpt from the PREVIOUS session — read-only memory for continuity. ' +
  'It is NOT part of the current conversation: do not respond to it, and do not treat its ' +
  'questions or offers as pending.';

/** Caveat wrappers captured from local-command turns — pure noise on re-injection. */
const CAVEAT_BLOCK_RE = /\*\*User:\*\* <local-command-caveat>[\s\S]*?<\/local-command-caveat>\s*/g;

/** Fence length must exceed any backtick run inside the quoted transcript. */
const longestBacktickRun = (text: string) => Math.max(0, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length));

async function lastSessionTail(maxBytes: number): Promise<TailResult> {
  const now = new Date();
  for (let offset = 0; offset < 7; offset++) {
    const day = new Date(now);
    day.setDate(day.getDate() - offset);
    const dateStr = day.toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
    const filename = `${dateStr}.md`;
    const logPath = resolve(FOLDERS.SESSIONS, filename);
    try {
      const content = await readFile(logPath, 'utf-8');
      const start = findLastSessionBlockStart(content);
      if (start === -1) continue;
      const block = content.slice(start).replace(TRAILING_SEPARATOR_RE, '').replace(CAVEAT_BLOCK_RE, '');
      const overflows = block.length > maxBytes;
      const body = overflows ? block.slice(0, maxBytes).trimEnd() : block;
      const fence = '`'.repeat(Math.max(3, longestBacktickRun(body) + 1));
      const suffix = overflows ? `\n\n_(truncated — full block in \`${logPath}\`)_` : '';
      const wrapped = `${TAIL_PREAMBLE}\n\n${fence}text\n${body}\n${fence}${suffix}`;
      return {
        content: wrapped,
        entry: {
          label: 'session tail',
          status: 'loaded',
          bytes: wrapped.length,
          note: offset === 0 ? filename : `${filename}, ${offset}d ago`
        }
      };
    } catch {
      // try previous day
    }
  }
  return {
    content: null,
    entry: { label: 'session tail', status: 'missing', bytes: 0 }
  };
}

interface ReportsResult {
  content: string | null;
  entry: ManifestEntry;
}

/**
 * Slice today's section out of `reports/index.md` and return it verbatim. The
 * index file is the source of truth — written transactionally by `writeReport`
 * alongside each report file, so it's always current.
 */
async function todaysReports(maxBytes: number): Promise<ReportsResult> {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
  let raw: string;
  try {
    raw = await readFile(FILES.REPORTS_INDEX, 'utf-8');
  } catch {
    return {
      content: null,
      entry: { label: "today's reports", status: 'missing', bytes: 0 }
    };
  }

  const lines = raw.split('\n');
  const headingIdx = lines.findIndex((line) => line.trim() === `## ${today}`);
  if (headingIdx === -1) {
    return {
      content: null,
      entry: {
        label: "today's reports",
        status: 'missing',
        bytes: 0,
        note: 'no entries today'
      }
    };
  }

  // Take lines after the heading until the next `## ` heading or EOF.
  let end = headingIdx + 1;
  while (end < lines.length && !/^## /.test(lines[end] ?? '')) end++;
  const sectionLines = lines.slice(headingIdx + 1, end);
  // Trim leading/trailing blank lines.
  while (sectionLines.length > 0 && sectionLines[0]?.trim() === '') sectionLines.shift();
  while (sectionLines.length > 0 && sectionLines[sectionLines.length - 1]?.trim() === '') sectionLines.pop();
  if (sectionLines.length === 0) {
    return {
      content: null,
      entry: {
        label: "today's reports",
        status: 'missing',
        bytes: 0,
        note: 'heading empty'
      }
    };
  }

  let body = sectionLines.join('\n');
  if (body.length > maxBytes) {
    body = `${body.slice(0, maxBytes).trimEnd()}\n…(see reports/index.md)`;
  }

  return {
    content: body,
    entry: {
      label: "today's reports",
      status: 'loaded',
      bytes: body.length,
      note: `${sectionLines.filter((line) => line.startsWith('- ')).length} entries`
    }
  };
}

const formatKB = (bytes: number) => `${(bytes / 1024).toFixed(1)}KB`;

const STATUS_ICON: Record<ManifestEntry['status'], string> = {
  loaded: '✓',
  missing: '✗',
  unavailable: '⚠',
  off: '○'
};

/**
 * Init leaves `welcome: "pending"` until the first session after relaunch has asked where to start.
 */
const welcomePending = (): boolean => readCadence().welcome === 'pending';

const LEVEL_COLOR: Record<NoticeLevel, string> = { hint: ANSI.cyan, nudge: ANSI.yellow, alert: ANSI.red };
const TONE_COLOR: Record<NonNullable<NoticeFact['tone']>, string> = { accent: ANSI.cyan, warn: ANSI.yellow };

/**
 * A text glyph rather than an emoji, so the level can color it; two spaces keep it in the emoji column.
 */
const noticeLine = (notice: Notice): string =>
  [
    `  ${paint(notice.icon, ANSI.bold, LEVEL_COLOR[notice.level])}  ${`${notice.label}:`.padEnd(11)}${paint(notice.title, ANSI.bold)}`,
    ...notice.facts.map((fact) => paint(fact.text, ...(fact.tone ? [TONE_COLOR[fact.tone]] : []))),
    paint(`run /${notice.command}`, ANSI.dim)
  ].join(' · ');

const welcomePart = (): string =>
  [
    '## First Session Since Init',
    '',
    `The operator just set this home up and relaunched. On their first message, read \`${resolve(FOLDERS.ROOT, 'skills', 'init', 'references', 'welcome.md')}\` and follow it: it asks where to start, with the roadmap first. Its commands run from the plugin root, \`${FOLDERS.ROOT}\`.`,
    'If that first message is a concrete task, do the task, then run the welcome at the end of the same turn.'
  ].join('\n');

function renderBanner(entries: ManifestEntry[], contextBytes: number, notices: readonly Notice[]): string {
  const labelWidth = Math.max(...entries.map((e) => e.label.length), 12);
  const sizeWidth = Math.max(...entries.map((e) => formatKB(e.bytes).length));
  const lines = entries.map((e) => {
    const label = e.label.padEnd(labelWidth);
    const size = formatKB(e.bytes).padStart(sizeWidth);
    const note = e.note ? `  (${e.note})` : '';
    return `    ${STATUS_ICON[e.status]} ${label}  ${size}${note}`;
  });
  const head = [
    `  🤖 Agent:     ${agentDisplayName()} · v${PLUGIN_VERSION}`,
    `  🧠 Knowledge: ${FOLDERS.KNOWLEDGE}`,
    `  📁 Projects:  ${FOLDERS.PROJECTS}`,
    `  📚 Context  · ${formatKB(contextBytes)}`
  ];
  head.splice(1, 0, ...notices.map(noticeLine));
  if (welcomePending()) {
    head.splice(1, 0, "  👋 Welcome:   first session, say hi and I'll suggest where to start");
  }
  return [...head, ...lines].join('\n');
}

export interface AssembledContext {
  context: string;
  banner: string;
  hasIssues: boolean;
}

/**
 * The knowledge lane says why history is missing instead of a bare ⚠, when the knowledge folder
 * lives in the home. A home with a remote, or one inside a larger project, keeps the plain log.
 */
function homeHistoryLane(plain: ManifestEntry, restored: boolean): ManifestEntry {
  if (!isInside(FOLDERS.KNOWLEDGE, FOLDERS.HOME)) {
    return plain;
  }
  const history = historyStatus(FOLDERS.HOME);
  const turnOn = `run /${PLUGIN_NAME}:history`;
  switch (history.state) {
    case 'off':
      return { ...plain, status: 'off', note: `off · ${turnOn}` };
    case 'git-missing':
      return { ...plain, status: 'unavailable', note: 'git not installed' };
    case 'pointer-missing':
      return { ...plain, status: 'unavailable', note: `link missing · ${turnOn}` };
    case 'history-missing':
      return { ...plain, status: 'unavailable', note: `folder missing · ${turnOn}` };
    case 'on':
      if (!history.lastCommit) {
        return { ...plain, status: 'unavailable', note: `no snapshots yet · ${turnOn}` };
      }
      if (history.homeSyncedBy) {
        return { ...plain, status: 'unavailable', note: `inside a synced folder · ${turnOn}` };
      }
      return restored && plain.note ? { ...plain, note: `${plain.note} · link restored` } : plain;
    case 'managed-by-you':
      return plain;
  }
}

/**
 * A synced folder can delete the one-line `.git` pointer while the history it points at survives;
 * put it back before the git lane reads it. Only the SessionStart payload does this, never the
 * status screen.
 */
function healHistoryLink(): boolean {
  try {
    const restored = restorePointer(FOLDERS.HOME);
    followMove(FOLDERS.HOME);
    return restored;
  } catch (err) {
    log.error('history link not restored', err);
    return false;
  }
}

interface GatheredContext {
  dateStr: string;
  entries: ManifestEntry[];
  /** Assembled markdown parts, joined by the caller. */
  parts: string[];
}

/**
 * Gather the dynamic SessionStart context once: today's date, last-session
 * tail, today's reports, and recent git activity across the tracked repos.
 * Shared by `assembleContext` (which renders the hook payload) and
 * `contextManifest` (which exposes the structured manifest for the status
 * screen) so the two never drift.
 */
async function gatherContext(restoredHistory = false): Promise<GatheredContext> {
  const tail = await lastSessionTail(CONTEXT.SESSION_TAIL_BYTES);
  const reports = await todaysReports(CONTEXT.REPORTS_BYTES);

  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: TIMEZONE
  });

  // Inside the home, the knowledge log is the home's own history, so it reads as that.
  const homeHistory = isInside(FOLDERS.KNOWLEDGE, FOLDERS.HOME);
  const repos: { label: string; lane: string; unit: string; path: string }[] = [
    {
      label: homeHistory ? 'history' : 'knowledge',
      lane: homeHistory ? 'history' : 'git: knowledge',
      unit: homeHistory ? 'snapshot' : 'commit',
      path: FOLDERS.KNOWLEDGE
    },
    ...extraGitRepos().map((path) => ({ label: basename(path), lane: `git: ${basename(path)}`, unit: 'commit', path }))
  ];
  const gitLogs = repos.map((repo) => ({
    ...repo,
    output: recentGitLog(repo.path)
  }));

  const [knowledgeGit, ...extraGit] = gitLogs.map(
    (log): ManifestEntry => ({
      label: log.lane,
      status: log.output ? 'loaded' : 'unavailable',
      bytes: log.output?.length ?? 0,
      note: log.output ? countOf(log.output.split('\n').length, log.unit) : undefined
    })
  );
  const entries: ManifestEntry[] = [
    tail.entry,
    reports.entry,
    ...(knowledgeGit ? [homeHistoryLane(knowledgeGit, restoredHistory)] : []),
    ...extraGit
  ];

  const traveling = HOME_TIMEZONE && HOME_TIMEZONE !== TIMEZONE ? ` — ✈️ traveling (home: ${HOME_TIMEZONE})` : '';
  const parts: string[] = [`## Today\n${dateStr} (${TIMEZONE})${traveling}`];
  if (welcomePending()) parts.push(welcomePart());
  if (tail.content) parts.push(`## Last Session Memory (archived — not this conversation)\n\n${tail.content}`);
  if (reports.content) parts.push(`## Today's Reports\n\n${reports.content}`);

  const gitSections = gitLogs
    .filter((log) => log.output)
    .map((log) => `### ${log.label}\n\n\`\`\`\n${log.output}\n\`\`\``);
  if (gitSections.length > 0) parts.push(`## Recent Git Activity\n\n${gitSections.join('\n\n')}`);

  const stranded = unresolvedPlaceholders();
  if (stranded.length > 0) {
    entries.push({ label: 'identity files', status: 'unavailable', bytes: 0, note: 'unresolved placeholders' });
    parts.push(
      [
        '## ⚠️ Unresolved scaffold placeholders',
        '',
        'These files still contain template placeholders that `init` or `upgrade` should have',
        'substituted. They are loaded into context every session, so the agent is reading its own',
        'identity with the placeholder in place:',
        '',
        ...stranded.map((line) => `- ${line}`),
        '',
        '**Report this to the operator and let them decide. Do not edit these files yourself',
        'unless they ask you to.** The likely cause is a failed substitution during init or',
        'upgrade, in which case the fix is to replace each placeholder with its intended value —',
        `\`{{AGENT_NAME}}\` is whatever \`IDENTITY.md\` gives as **Name**. But an operator may also`,
        'have written this text deliberately (notes about a templating system, for instance), and',
        'silently rewriting their own words would be worse than the warning. Do not re-run init to',
        'repair it either: the re-run path offers to overwrite these same files.'
      ].join('\n')
    );
  }

  const layout = manualLayoutIssues();
  if (layout.length > 0) {
    entries.push({ label: 'manual layout', status: 'unavailable', bytes: 0, note: 'needs upgrade' });
    parts.push(
      [
        '## ⚠️ Operating manual layout',
        '',
        ...layout.map((line) => `- ${line}`),
        '',
        '**Report this to the operator.** Do not move or delete the files yourself; the upgrade',
        'backs up, verifies, and rolls back, and a by-hand move has none of that.'
      ].join('\n')
    );
  }

  // A session still on the pre-0.7.0 plugin writes to the legacy folder after the upgrade moved it.
  if (basename(FOLDERS.DATA) === RUNTIME_DIR && existsSync(resolve(FOLDERS.HOME, LEGACY_RUNTIME_DIR))) {
    entries.push({ label: 'data folder', status: 'unavailable', bytes: 0, note: `${LEGACY_RUNTIME_DIR}/ is back` });
    parts.push(
      [
        '## ⚠️ Two data folders',
        '',
        `\`${LEGACY_RUNTIME_DIR}/\` exists beside \`${RUNTIME_DIR}/\`, which is the one in use. A session still running the`,
        'plugin from before the move wrote there after the upgrade, so whatever it saved (often the compile',
        'cursor `knowledge.json` or `cadence.json`) is not being read.',
        '',
        `**Report this to the operator.** They close that session, compare what is in \`${LEGACY_RUNTIME_DIR}/\`, and`,
        `move anything newer into \`${RUNTIME_DIR}/\` before removing it. Do not move or delete it yourself.`
      ].join('\n')
    );
  }

  // A due upgrade re-points the footer itself, and the banner's upgrade line already says to run it.
  const statusLine =
    getUpgradeStatus().state === 'current'
      ? statusLineDrift(
          resolve(FOLDERS.HOME, '.claude'),
          resolve(FOLDERS.ROOT, 'bin', PLUGIN_NAME.replace(/^agent-/, ''))
        )
      : undefined;
  if (statusLine) {
    entries.push({ label: 'status line', status: 'unavailable', bytes: 0, note: 'needs upgrade' });
    parts.push(
      [
        '## ⚠️ Status line',
        '',
        `- ${statusLine}`,
        '',
        '**Report this to the operator.** The upgrade re-points the entry from the plugin that is',
        'actually loaded; a by-hand edit of `settings.json` is what the sandbox exists to prevent.'
      ].join('\n')
    );
  }

  const hosts = hostIssues(checkHosts(requiredHosts(FOLDERS.HOME)));
  if (hosts.length > 0) {
    entries.push({ label: 'host versions', status: 'unavailable', bytes: 0, note: 'update the host' });
    parts.push(
      [
        '## ⚠️ Host versions',
        '',
        ...hosts.map((line) => `- ${line}`),
        '',
        '**Report this to the operator.** The plugin carries no compatibility shims for older hosts;',
        'init and upgrade refuse to run until the host is updated.'
      ].join('\n')
    );
  }

  return { dateStr, entries, parts };
}

/**
 * Scaffold placeholders left unresolved in the home's identity files.
 *
 * `init` and `upgrade` substitute `{{TOKEN}}` when they write these, and both
 * check their own work — but both are skills, so the check is an instruction a
 * model has to follow rather than something the code enforces. A miss is
 * otherwise silent: the raw token sits in the file and loads into every session
 * from then on. This is the mechanical backstop, and it costs five small reads
 * once per session.
 *
 * Matches the template convention (`{{ALL_CAPS}}`) rather than a fixed list, so
 * a token added later is caught without anyone remembering to update this.
 */
const unresolvedPlaceholders = (): string[] => {
  const files = [operatingManualPath(), FILES.CLAUDE, FILES.SOUL, FILES.IDENTITY, FILES.USER];
  return files.flatMap((file) => {
    try {
      const found = [...readFileSync(file, 'utf-8').matchAll(/\{\{[A-Z][A-Z0-9_]*\}\}/g)].map((match) => match[0]);
      return found.length > 0 ? [`${basename(file)}: ${[...new Set(found)].join(', ')}`] : [];
    } catch {
      return []; // absent file — normal (the bridge before migration, USER.md pre-init)
    }
  });
};

/**
 * Layout states the 0.4.0 manual migration can leave behind when interrupted, or an
 * operator can create by hand — each one means Claude Code loads the wrong thing at
 * session start, so it is worth a line in the banner every session until fixed.
 */
const manualLayoutIssues = (): string[] => {
  if (!existsSync(FILES.AGENTS)) return [];
  const issues: string[] = [];
  if (!existsSync(FILES.CLAUDE)) {
    issues.push(
      `\`.claude/CLAUDE.md\` is missing, so Claude Code loads neither the manual nor the identity stack — run \`/${PLUGIN_NAME}:upgrade\` to write the bridge`
    );
  }
  try {
    if (/^## Memory Routing\s*$/m.test(readFileSync(FILES.CLAUDE_ROOT, 'utf-8'))) {
      issues.push(
        `the root \`CLAUDE.md\` is still the pre-0.4.0 operating manual, so the manual loads twice — run \`/${PLUGIN_NAME}:upgrade\` to move it aside`
      );
    }
  } catch {
    // no root CLAUDE.md — the normal state
  }
  return issues;
};

/**
 * `withNotices: false` leaves the notices to a surface that draws them itself.
 */
export async function assembleContext({
  withNotices = true
}: { withNotices?: boolean } = {}): Promise<AssembledContext> {
  // Started first so its file reads overlap the git calls gathering does.
  const pendingNotices = withNotices
    ? collectNotices().catch((err: unknown) => {
        log.error('notices skipped', err);
        return [];
      })
    : Promise.resolve([]);
  const { entries, parts } = await gatherContext(healHistoryLink());

  let context = parts.join('\n\n---\n\n');
  if (context.length > CONTEXT.MAX_CHARS) {
    context = context.slice(0, CONTEXT.MAX_CHARS) + '\n\n...(truncated)';
  }
  const notices = await pendingNotices;
  const banner = renderBanner(entries, context.length, notices);
  const hasIssues = entries.some((entry) => entry.status !== 'loaded' && entry.status !== 'off');
  return { context, banner, hasIssues };
}

export interface ContextManifest {
  date: string;
  entries: ManifestEntry[];
  bytes: number;
}

/** Structured view of the dynamic SessionStart context — consumed by the
 *  `status` screen's Context Assembly tab. */
export async function contextManifest(): Promise<ContextManifest> {
  const { dateStr, entries, parts } = await gatherContext();
  const bytes = Math.min(parts.join('\n\n---\n\n').length, CONTEXT.MAX_CHARS);
  return { date: dateStr, entries, bytes };
}
