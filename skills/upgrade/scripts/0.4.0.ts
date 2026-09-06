#!/usr/bin/env bun
/**
 * Upgrade migration for v0.4.0 — the operating manual moves to `AGENTS.md`.
 *
 * Before: `<HOME>/CLAUDE.md` (or `CLAUDE.local.md` in the init-collision case)
 * held the manual with Claude Code's `@-import` header on top, so only Claude
 * Code could load it. After: `<HOME>/AGENTS.md` is the manual, read natively by
 * every AGENTS.md-aware CLI, and `<HOME>/.claude/CLAUDE.md` is a bridge that
 * `@-imports` it plus the identity stack for Claude Code. This script does the
 * structural move only — renames the title, strips the import header, writes
 * the bridge, removes the legacy file — and leaves section content alone so the
 * upgrade skill's template reconciliation shows every prose change as a diff.
 *
 * Run by `/agent-kevin:upgrade` via `run_upgrade` (outside the Bash sandbox).
 * Self-contained, idempotent, fail-loud: nothing is deleted until the new files
 * are written and verified, and every touched file is backed up first.
 *
 * Contract: prints a single-line JSON report as its LAST stdout line; exits
 * non-zero on failure.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const VERSION = '0.4.0';
const first = (...values: (string | undefined)[]): string | undefined =>
  values.map((value) => value?.trim()).find((value) => value);

// Per-agent override first, then the shared name — the same rule as the server's env().
const HOME = resolve(first(process.env.KEVIN_HOME, process.env.AGENT_HOME) ?? process.cwd());
const PLUGIN_ROOT = resolve(
  first(process.env.KEVIN_PLUGIN_ROOT, process.env.AGENT_PLUGIN_ROOT) ?? resolve(import.meta.dir, '..', '..', '..')
);
const RUNTIME_DIR = first(process.env.KEVIN_RUNTIME_DIR, process.env.AGENT_RUNTIME_DIR) ?? '.kevin';

const AGENTS = resolve(HOME, 'AGENTS.md');
const BRIDGE = resolve(HOME, '.claude', 'CLAUDE.md');
const LEGACY_ROOT = resolve(HOME, 'CLAUDE.md');
const LEGACY_LOCAL = resolve(HOME, 'CLAUDE.local.md');
const IDENTITY = resolve(HOME, 'IDENTITY.md');
const TEMPLATE_AGENTS = resolve(PLUGIN_ROOT, 'templates', 'AGENTS.md');
const TEMPLATE_BRIDGE = resolve(PLUGIN_ROOT, 'templates', 'CLAUDE.md');
const BRIDGE_IMPORT = '@../AGENTS.md';

const homeRel = (path: string): string => relative(HOME, path).split(sep).join('/');
const read = (path: string): string => readFileSync(path, 'utf-8');
const toLf = (text: string): string => text.replace(/\r\n/g, '\n');

/** The agent's manual, as opposed to a project's own instructions file at the same path. */
const looksLikeManual = (text: string): boolean =>
  /^## (Memory Routing|Knowledge Structure|Task System)\s*$/m.test(text) || /^@SOUL\.md\s*$/m.test(text);

/** Leading `@path` import lines (and the blank lines between them) vs. everything after. */
const splitImportHeader = (text: string): { imports: string[]; body: string } => {
  const lines = text.split('\n');
  const imports: string[] = [];
  let index = 0;
  while (index < lines.length && (lines[index].startsWith('@') || lines[index].trim() === '')) {
    if (lines[index].startsWith('@')) imports.push(lines[index].trim());
    index += 1;
  }
  return { imports, body: lines.slice(index).join('\n') };
};

const isAbsoluteLike = (path: string): boolean => isAbsolute(path) || /^[A-Za-z]:/.test(path);

/** A home-relative root as `.claude/CLAUDE.md` must import it: one level up, unless it was absolute. */
const asBridgeImport = (rel: string): string => {
  if (isAbsoluteLike(rel)) return rel;
  const clean = rel.replace(/^\.\//, '');
  return clean === '.' || clean === '' ? '..' : `../${clean}`;
};

const envRoot = (suffix: string, fallback: string): string => {
  const configured = first(process.env[`KEVIN_${suffix}`], process.env[`AGENT_${suffix}`]);
  if (!configured) return fallback;
  const rel = relative(HOME, resolve(configured));
  return rel && !rel.startsWith('..') && !isAbsoluteLike(rel) ? rel.split(sep).join('/') : resolve(configured);
};

/** The six lines the template put in the header; anything else the operator added. */
const isTemplateImport = (line: string, roots: { knowledge: string; projects: string }): boolean =>
  [
    '@SOUL.md',
    '@IDENTITY.md',
    '@USER.md',
    `@${roots.knowledge}/index.md`,
    `@${roots.knowledge}/memory/index.md`,
    `@${roots.projects}/TASKS.md`
  ].includes(line);

/** Splice extra import lines into the bridge right after its own import block. */
const withImports = (bridge: string, extra: string[]): string => {
  if (extra.length === 0) return bridge;
  const lines = bridge.split('\n');
  const end = lines.findIndex((line) => !line.startsWith('@'));
  return [...lines.slice(0, end), ...extra, ...lines.slice(end)].join('\n');
};

/** Knowledge / projects roots as the legacy header spelled them; env, then defaults, when it didn't. */
const rootsFromImports = (imports: string[]): { knowledge: string; projects: string } => {
  const knowledge = imports.map((line) => line.match(/^@(.+)\/memory\/index\.md$/)?.[1]).find(Boolean);
  const projects = imports.map((line) => line.match(/^@(.+)\/TASKS\.md$/)?.[1]).find(Boolean);
  return {
    knowledge: knowledge ?? envRoot('KNOWLEDGE', 'knowledge'),
    projects: projects ?? envRoot('PROJECTS', 'projects')
  };
};

const agentName = (fallbackFrom: string): string => {
  if (existsSync(IDENTITY)) {
    const name = read(IDENTITY)
      .match(/\*\*Name:\*\*[ \t]*(.+)$/m)?.[1]
      ?.trim();
    if (name && !name.includes('{{')) return name;
  }
  return fallbackFrom.match(/^# (?:CLAUDE|AGENTS)\.md — (.+?)'s Operating Manual\s*$/m)?.[1]?.trim() || 'Kevin';
};

const TOKEN_RE = /\{\{[A-Z][A-Z0-9_]*\}\}/g;

const render = (template: string, tokens: Record<string, string>): string => {
  const out = Object.entries(tokens).reduce((text, [key, value]) => text.split(`{{${key}}}`).join(value), template);
  const left = [...new Set(out.match(TOKEN_RE) ?? [])];
  if (left.length > 0) throw new Error(`template placeholders left unresolved: ${left.join(', ')}`);
  return out;
};

/** Text before the first `## ` heading, and the rest from that heading on. */
const splitPreamble = (text: string): { preamble: string; sections: string } => {
  const at = text.search(/^## /m);
  return at === -1 ? { preamble: text, sections: '' } : { preamble: text.slice(0, at), sections: text.slice(at) };
};

const headings = (text: string): string[] => (text.match(/^## .+$/gm) ?? []).map((line) => line.trim());

/**
 * The legacy preamble minus what the template wrote there (the CLAUDE.md title and
 * the Claude-Code-auto-loads paragraph). Whatever is left is the operator's and is
 * carried across verbatim.
 */
const operatorPreamble = (preamble: string): string =>
  preamble
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(
      (paragraph) =>
        paragraph !== '' &&
        !/^# CLAUDE\.md — .*Operating Manual\s*$/.test(paragraph) &&
        !paragraph.startsWith('Claude Code auto-loads this file')
    )
    .join('\n\n');

const USER_MD = resolve(HOME, 'USER.md');
const USER_SENTENCE_OLD = 'reads this every session (via `@-import` in `CLAUDE.md`).';
const USER_SENTENCE_NEW = 'reads this every session (it is part of the identity stack loaded at session start).';
const SWEEP_SKIP = new Set(['.git', '.kevin', 'node_modules', 'raw', 'reports', 'archive', 'tasks', RUNTIME_DIR]);
const LINK_RE = /\[([^\]]*)\]\(([^)\s]+)\)/g;

/** Every `.md` under the home the operator authors by hand — never transcripts, runtime state, reports, archives, or tasks. */
const authoredMarkdown = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || SWEEP_SKIP.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return authoredMarkdown(path);
    return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
  });

/**
 * Rewrite markdown links that resolve to the file being moved so they resolve to
 * AGENTS.md instead. Prose mentions are left alone — history is history. Returns
 * the home-relative paths of files changed.
 */
const rewriteLinks = (movedFrom: string): string[] =>
  authoredMarkdown(HOME)
    .filter((file) => {
      if (file === movedFrom || file === AGENTS) return false;
      const raw = read(file);
      let changed = false;
      const next = raw.replace(LINK_RE, (whole, label: string, target: string) => {
        if (/^[a-z]+:/i.test(target) || target.startsWith('#')) return whole;
        const [path, ...fragment] = target.split('#');
        if (resolve(dirname(file), path) !== movedFrom) return whole;
        changed = true;
        const replacement = relative(dirname(file), AGENTS).split(sep).join('/');
        // A label that is just the old filename would lie once the target moves.
        const text = label === 'CLAUDE.md' ? 'AGENTS.md' : label;
        return `[${text}](${replacement}${fragment.length ? '#' + fragment.join('#') : ''})`;
      });
      if (changed) writeFileSync(file, next);
      return changed;
    })
    .map(homeRel)
    .sort();

/** The one template sentence USER.md carries that names the old file; exact match only, operator prose untouched. */
const retargetUserSentence = (): boolean => {
  if (!existsSync(USER_MD)) return false;
  const raw = read(USER_MD);
  if (!raw.includes(USER_SENTENCE_OLD)) return false;
  writeFileSync(USER_MD, raw.split(USER_SENTENCE_OLD).join(USER_SENTENCE_NEW));
  return true;
};

interface Report {
  ok: true;
  version: string;
  action: 'migrated' | 'already-migrated';
  source?: string;
  removed: string[];
  /** Home-relative files whose markdown links to the moved manual were retargeted to AGENTS.md. */
  linksRewritten: string[];
  userSentenceRetargeted: boolean;
  backup?: string;
  agentName?: string;
  knowledgeRoot?: string;
  projectsRoot?: string;
  notes: string[];
}

const emit = (report: Report): void => {
  process.stdout.write(JSON.stringify(report) + '\n');
};

function main(): void {
  const notes: string[] = [];
  const agentsIsManual = existsSync(AGENTS) && looksLikeManual(read(AGENTS));
  const source = [LEGACY_LOCAL, LEGACY_ROOT].find((path) => existsSync(path) && looksLikeManual(read(path)));

  if (!source) {
    if (agentsIsManual && existsSync(BRIDGE) && read(BRIDGE).includes(BRIDGE_IMPORT)) {
      emit({
        ok: true,
        version: VERSION,
        action: 'already-migrated',
        removed: [],
        linksRewritten: [],
        userSentenceRetargeted: false,
        notes
      });
      return;
    }
    if (!agentsIsManual) {
      throw new Error(
        `no operating manual found: none of ${homeRel(AGENTS)}, ${homeRel(LEGACY_LOCAL)}, ${homeRel(LEGACY_ROOT)} is the agent's manual. Restore it from the brain repo or a backup, then re-run the upgrade.`
      );
    }
  }

  for (const path of [TEMPLATE_AGENTS, TEMPLATE_BRIDGE]) {
    if (!existsSync(path)) {
      throw new Error(`plugin template missing: ${path} (is the plugin at ${PLUGIN_ROOT} on ${VERSION}?)`);
    }
  }

  // ── 1. Back up everything this run may rewrite or remove ───────────────────
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  const backup = resolve(HOME, RUNTIME_DIR, 'updates', `${VERSION}-manual-${stamp}`);
  const backedUp: string[] = [];
  for (const path of [source, AGENTS, BRIDGE, LEGACY_ROOT, LEGACY_LOCAL]) {
    if (path && existsSync(path) && !backedUp.includes(path)) {
      const target = resolve(backup, homeRel(path));
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(path, target);
      backedUp.push(path);
    }
  }

  // ── 2. Build AGENTS.md from the legacy manual ──────────────────────────────
  // Processed as LF, written back with the legacy file's own line ending so a
  // CRLF home (Windows, autocrlf checkouts) doesn't get every line rewritten.
  const legacyRaw = source ? read(source) : '';
  const eol = legacyRaw.includes('\r\n') ? '\r\n' : '\n';
  const legacy = toLf(legacyRaw);
  const { imports, body } = splitImportHeader(legacy);
  const { preamble, sections } = splitPreamble(body);
  const preambleLines = preamble.split('\n');
  // Every import line, wherever it sits: the header, or below a comment/title the
  // operator put above it. Roots and operator imports both derive from this set.
  const importLines = [...imports, ...preambleLines.map((line) => line.trim()).filter((line) => line.startsWith('@'))];
  const roots = rootsFromImports(importLines);
  const name = agentName(legacy || (existsSync(AGENTS) ? read(AGENTS) : ''));
  const tokens = {
    AGENT_NAME: name,
    KNOWLEDGE_REL: roots.knowledge,
    PROJECTS_REL: roots.projects,
    KNOWLEDGE_IMPORT: asBridgeImport(roots.knowledge),
    PROJECTS_IMPORT: asBridgeImport(roots.projects)
  };

  // Imports the operator added beyond the template's six (in the header or below the
  // title) are Claude Code context, so they move into the bridge — re-rooted one level
  // down — never into the harness-neutral manual.
  const operatorImports = importLines
    .filter((line) => !isTemplateImport(line, roots))
    .map((line) => `@${asBridgeImport(line.slice(1))}`);
  const preambleProse = preambleLines.filter((line) => !line.trim().startsWith('@')).join('\n');

  // Every write this run makes is undone if verification fails: files it created are
  // removed, files it appended to are restored from the backup. The legacy manual is
  // not touched until everything verified, so a failed run leaves the home as it was.
  const created: string[] = [];
  const write = (path: string, text: string): void => {
    if (!existsSync(path)) created.push(path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  const rollback = (): void => {
    for (const path of created) rmSync(path, { force: true });
    for (const path of backedUp) copyFileSync(resolve(backup, homeRel(path)), path);
  };

  try {
    let expectedHeadings: string[] = [];
    if (source && !agentsIsManual) {
      if (sections === '') {
        throw new Error(`${homeRel(source)} has no "## " sections — not a manual this migration understands.`);
      }
      const carried = operatorPreamble(preambleProse);
      if (carried) {
        notes.push(
          `Operator text found above the first section of ${homeRel(source)} was carried into AGENTS.md verbatim.`
        );
      }
      const templatePreamble = render(splitPreamble(toLf(read(TEMPLATE_AGENTS))).preamble, tokens).trimEnd();
      const manual = ([templatePreamble, carried, sections.trimEnd()].filter(Boolean).join('\n\n') + '\n').replace(
        /\n/g,
        eol
      );
      expectedHeadings = headings(sections);

      if (existsSync(AGENTS)) {
        // A project's own AGENTS.md is already here: the manual joins it rather than
        // replacing it — same shape as a seed overlay, and upgrade reconciles by section.
        write(AGENTS, read(AGENTS).trimEnd() + eol + eol + manual);
        notes.push(
          "AGENTS.md already existed and was not the agent's manual — the manual was appended below the existing content. Review the combined file once."
        );
      } else {
        write(AGENTS, manual);
      }
    } else if (source && agentsIsManual) {
      notes.push(
        `AGENTS.md was already the agent's manual (an earlier run got that far), so ${homeRel(source)} was backed up and removed without merging. If you edited it after that run, diff the backup.`
      );
    }

    // ── 3. Verify the manual before the bridge exists ──────────────────────────
    const agentsText = read(AGENTS);
    if (!looksLikeManual(agentsText)) {
      throw new Error('verify failed: AGENTS.md does not read as the manual.');
    }
    const missing = expectedHeadings.filter((heading) => !agentsText.includes(heading));
    if (missing.length > 0) {
      throw new Error(`verify failed: sections missing from AGENTS.md: ${missing.join(', ')}.`);
    }

    // ── 4. Write and verify the Claude Code bridge ─────────────────────────────
    const bridgeText = withImports(render(read(TEMPLATE_BRIDGE), tokens), operatorImports);
    let bridgeWritten = true;
    if (!existsSync(BRIDGE)) {
      write(BRIDGE, bridgeText);
    } else if (!read(BRIDGE).includes(BRIDGE_IMPORT)) {
      write(BRIDGE, read(BRIDGE).trimEnd() + '\n\n' + bridgeText);
      notes.push(
        '.claude/CLAUDE.md already existed without the AGENTS.md import — the bridge was appended below its content.'
      );
    } else {
      bridgeWritten = false;
    }
    if (operatorImports.length > 0) {
      notes.push(
        bridgeWritten
          ? `Operator @-imports moved from the manual into .claude/CLAUDE.md: ${operatorImports.join(', ')}`
          : `.claude/CLAUDE.md was already bridged, so these imports from the legacy manual were NOT added to it — add them by hand if still wanted: ${operatorImports.join(', ')}`
      );
    }
    const bridgeNow = read(BRIDGE);
    for (const line of [BRIDGE_IMPORT, '@../SOUL.md', '@../IDENTITY.md', '@../USER.md']) {
      if (!bridgeNow.includes(line)) {
        throw new Error(`verify failed: .claude/CLAUDE.md lacks ${line}.`);
      }
    }
    const strayTokens = [...new Set([...(agentsText.match(TOKEN_RE) ?? []), ...(bridgeNow.match(TOKEN_RE) ?? [])])];
    if (strayTokens.length > 0) {
      notes.push(
        `Unresolved placeholders present (${strayTokens.join(', ')}) — they were already in the legacy manual; the SessionStart backstop keeps flagging them until fixed.`
      );
    }
  } catch (err) {
    rollback();
    throw new Error(
      `${err instanceof Error ? err.message : String(err)} Nothing changed: this run's files were removed and the legacy manual left in place.`
    );
  }

  // ── 5. Retarget links, then remove the legacy manual ───────────────────────
  // Links first: they compare against the moved path, not the file, and a failure
  // here leaves a consistent home that a re-run completes.
  const linksRewritten = source === LEGACY_ROOT ? rewriteLinks(LEGACY_ROOT) : [];
  const userSentenceRetargeted = retargetUserSentence();
  const removed: string[] = [];
  if (source) {
    rmSync(source);
    removed.push(homeRel(source));
  }
  if (source === LEGACY_LOCAL && existsSync(LEGACY_ROOT)) {
    notes.push(
      "Your own CLAUDE.md stays at the home root (it was never the agent's). Claude Code loads it alongside .claude/CLAUDE.md; confirm both appear in /context on the next session."
    );
  }

  emit({
    ok: true,
    version: VERSION,
    action: 'migrated',
    source: source ? homeRel(source) : undefined,
    removed,
    linksRewritten,
    userSentenceRetargeted,
    backup: homeRel(backup),
    agentName: name,
    knowledgeRoot: roots.knowledge,
    projectsRoot: roots.projects,
    notes
  });
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(JSON.stringify({ ok: false, version: VERSION, error: message }) + '\n');
  process.exit(1);
}
