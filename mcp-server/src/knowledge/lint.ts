/**
 * Knowledge lint — structural health checks on the wiki.
 *
 * Single-user, plugin-edition: no LLM contradiction check (the plugin has no
 * LLM gateway — synthesis happens in the calling Claude Code session). All
 * checks are filesystem-pure and free to run.
 *
 * Entry points:
 *   CLI:        `kevin knowledge lint [--fix]`
 *   MCP tool:   `knowledge_lint` (defined in tools/knowledge.ts)
 *   Library:    import { run } from "./lint";  run({ fixMode })
 *
 * Auto-fix (`--fix`) rewrites stale wikilinks and inserts missing backlinks.
 */

import { FOLDERS } from '@/config';
import { createLogger } from '@/shared/log';
import { nowISO, repoRelative } from '@/shared/utils';
import { readFile, writeFile } from 'fs/promises';
import { basename, dirname, relative, resolve } from 'path';
import { loadLinkTargets, rewriteAllWikilinks, type WikilinkMap } from './links';
import { loadState, saveState } from './state';
import {
  extractWikilinks,
  listRawFiles,
  readAllWikiContent,
  readWikiIndex,
  stripFrontmatter as stripFrontmatterShared,
  wikiArticleExists
} from './utils';

const log = createLogger('knowledge.lint');
const fixLog = createLogger('knowledge.lint.fix');

const SPARSE_WARN_THRESHOLD = 50;
const SPARSE_SUGGEST_THRESHOLD = 200;

const PERMANENT_DIRS = ['user/', 'concepts/'] as const;

interface LintIssue {
  check: string;
  severity: 'error' | 'warning' | 'suggestion';
  message: string;
  file?: string;
  autoFixed?: boolean;
}

export interface LintOptions {
  fixMode?: boolean;
}

export interface LintSummary {
  status: 'success' | 'error';
  duration: number;
  message: string;
  errors: number;
  warnings: number;
  suggestions: number;
  fixed: number;
  reportPath: string;
}

// ── Checks ────────────────────────────────────────────────────────────

async function checkBrokenLinks(articles: Map<string, string>): Promise<LintIssue[]> {
  const checks = [...articles].flatMap(([relPath, content]) =>
    extractWikilinks(content).map((link) => ({ relPath, link }))
  );
  const results = await Promise.all(checks.map(async ({ relPath, link }) => ({ relPath, link, exists: await wikiArticleExists(link) })));
  return results
    .filter(({ exists }) => !exists)
    .map(({ relPath, link }) => ({
      check: 'Broken links',
      severity: 'error' as const,
      message: `[[${link}]] in ${relPath} points to non-existent article`,
      file: relPath
    }));
}

async function checkOrphanPages(articles: Map<string, string>): Promise<LintIssue[]> {
  const indexContent = await readWikiIndex();
  const inboundLinks = new Set<string>([
    ...extractWikilinks(indexContent),
    ...[...articles.values()].flatMap((content) => extractWikilinks(content))
  ]);

  return [...articles.keys()]
    .filter((relPath) => !isTransientMemory(relPath))
    .filter((relPath) => !inboundLinks.has(relPath.replace(/\.md$/, '')))
    .map((relPath) => ({
      check: 'Orphan pages',
      severity: 'warning' as const,
      message: `${relPath} has no inbound links from other articles or index`,
      file: relPath
    }));
}

async function checkOrphanSources(): Promise<LintIssue[]> {
  const state = await loadState();
  const rawFiles = await listRawFiles();
  return rawFiles
    .map((filePath) => basename(filePath))
    .filter((name) => !state.ingested[name])
    .map((name) => ({
      check: 'Orphan sources',
      severity: 'warning' as const,
      message: `${name} has not been compiled yet`,
      file: name
    }));
}

async function checkMissingBacklinks(articles: Map<string, string>, root = FOLDERS.KNOWLEDGE): Promise<LintIssue[]> {
  const issues: LintIssue[] = [];

  for (const [relPath, content] of articles) {
    // Skip index files as sources — they're navigation hubs, not destinations
    // expected to maintain bidirectional links. Mirrors `fixMissingBacklinks`.
    if (relPath.endsWith('index.md') || isTransientMemory(relPath)) continue;
    const links = extractWikilinks(stripFrontmatter(content));
    const selfLink = relPath.replace(/\.md$/, '');

    for (const link of links) {
      const targetPath = link + '.md';
      // Transient memory targets (manifest entries in memory/index.md → daily
      // files) shouldn't be expected to maintain backlinks — they auto-prune.
      if (isTransientMemory(targetPath)) continue;
      const targetContent = articles.get(targetPath);
      if (!targetContent) continue;

      if (!targetLinksBack(targetContent, targetPath, selfLink, root)) {
        issues.push({
          check: 'Missing backlinks',
          severity: 'suggestion',
          message: `${relPath} links to [[${link}]] but ${targetPath} doesn't link back`,
          file: targetPath
        });
      }
    }
  }
  return issues;
}

async function checkSparseArticles(articles: Map<string, string>): Promise<LintIssue[]> {
  return [...articles].flatMap<LintIssue>(([relPath, content]) => {
    const body = content.replace(/^---[\s\S]*?---\n*/, '');
    const wordCount = body.split(/\s+/).filter(Boolean).length;
    if (wordCount < SPARSE_WARN_THRESHOLD) {
      return [{
        check: 'Sparse articles',
        severity: 'warning',
        message: `${relPath} has only ${wordCount} words (severely sparse, threshold: ${SPARSE_WARN_THRESHOLD})`,
        file: relPath
      }];
    }
    if (wordCount < SPARSE_SUGGEST_THRESHOLD) {
      return [{
        check: 'Sparse articles',
        severity: 'suggestion',
        message: `${relPath} has only ${wordCount} words (threshold: ${SPARSE_SUGGEST_THRESHOLD})`,
        file: relPath
      }];
    }
    return [];
  });
}

/**
 * Permanent articles must not link to transient daily memory files —
 * `memory/YYYY-MM-DD*.md` get pruned, leaving dangling references.
 */
async function checkTransientMemoryRefs(articles: Map<string, string>): Promise<LintIssue[]> {
  const transientRe = /\[\[memory\/\d{4}-\d{2}-\d{2}[^\]]*\]\]/g;
  const issues: LintIssue[] = [];

  for (const [relPath, content] of articles) {
    if (!PERMANENT_DIRS.some((d) => relPath.startsWith(d))) continue;
    const matches = content.match(transientRe);
    if (!matches) continue;
    for (const link of matches) {
      issues.push({
        check: 'Transient memory refs',
        severity: 'error',
        message: `${relPath} references transient ${link} (memory/YYYY-MM-DD files auto-prune after 14 days — anchor permanent articles to other permanent articles instead)`,
        file: relPath
      });
    }
  }
  return issues;
}

/**
 * Detect link syntax inside YAML frontmatter values.
 * Cross-references belong in the body — frontmatter is plain scalars only.
 */
async function checkInvalidFrontmatter(articles: Map<string, string>): Promise<LintIssue[]> {
  const fmRe = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const issues: LintIssue[] = [];

  for (const [relPath, content] of articles) {
    const match = content.match(fmRe);
    if (!match) continue;
    for (const line of match[1].split(/\r?\n/)) {
      const key = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):/)?.[1];
      if (!key) continue;
      if (/\]\(/.test(line)) {
        issues.push({
          check: 'Invalid frontmatter',
          severity: 'error',
          message: `${relPath} frontmatter \`${key}:\` contains markdown link syntax — YAML can't parse \`[text](url)\`. Move cross-references to the body.`,
          file: relPath
        });
      } else if (/\[\[/.test(line)) {
        issues.push({
          check: 'Invalid frontmatter',
          severity: 'error',
          message: `${relPath} frontmatter \`${key}:\` contains a wikilink — frontmatter values must be plain data; the pipeline ignores links there. Move to the body.`,
          file: relPath
        });
      }
    }
  }
  return issues;
}

// ── Helpers (exported for tests) ──────────────────────────────────────

export const stripFrontmatter = stripFrontmatterShared;

export const isTransientMemory = (relPath: string): boolean => /^memory\/\d{4}-\d{2}-\d{2}/.test(relPath);

export function targetLinksBack(
  targetContent: string,
  targetRelPath: string,
  sourceLink: string,
  root: string = FOLDERS.KNOWLEDGE
): boolean {
  if (extractWikilinks(stripFrontmatter(targetContent)).includes(sourceLink)) return true;
  const targetDir = dirname(resolve(root, targetRelPath));
  const sourceAbs = resolve(root, sourceLink + '.md');
  const relP = relative(targetDir, sourceAbs);
  const escaped = relP.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\]\\(${escaped}(?:#[^)]*)?\\)`).test(targetContent);
}

// ── Auto-fix ──────────────────────────────────────────────────────────

export async function fixWikilinks(articles?: Map<string, string>): Promise<LintIssue[]> {
  fixLog.info('Rewriting wikilinks');
  const changed = await rewriteAllWikilinks();

  const issues = await Promise.all(
    changed.map(async (absPath) => {
      const relPath = relative(FOLDERS.KNOWLEDGE, absPath);
      if (articles) {
        try {
          articles.set(relPath, await readFile(absPath, 'utf-8'));
        } catch {
          // best-effort sync — file might have been removed mid-flight
        }
      }
      return {
        check: 'Broken links',
        severity: 'error' as const,
        message: `Rewrote wikilinks in ${relPath}`,
        file: relPath,
        autoFixed: true
      };
    })
  );

  fixLog.info(`Wikilinks: ${issues.length} file(s) rewritten`);
  return issues;
}

export interface FixBacklinksOpts {
  root?: string;
  linkMap?: WikilinkMap;
}

export async function fixMissingBacklinks(
  articles: Map<string, string>,
  opts: FixBacklinksOpts = {}
): Promise<LintIssue[]> {
  fixLog.info('Scanning for missing backlinks');

  const root = opts.root ?? FOLDERS.KNOWLEDGE;
  const linkMap = opts.linkMap ?? (await loadLinkTargets());

  // target -> sources that should link back
  const needed = new Map<string, Set<string>>();

  for (const [relPath, content] of articles) {
    if (relPath.endsWith('index.md') || isTransientMemory(relPath)) continue;

    const links = extractWikilinks(stripFrontmatter(content));
    const selfLink = relPath.replace(/\.md$/, '');

    for (const link of links) {
      const targetPath = link + '.md';
      // Transient memory targets auto-prune — don't add See Also sections to files that will disappear.
      if (isTransientMemory(targetPath)) continue;
      const targetContent = articles.get(targetPath);
      if (!targetContent || targetPath.endsWith('index.md')) continue;
      if (targetLinksBack(targetContent, targetPath, selfLink, root)) continue;

      const set = needed.get(targetPath) ?? new Set<string>();
      set.add(selfLink);
      needed.set(targetPath, set);
    }
  }

  const fixed: LintIssue[] = [];
  for (const [targetPath, sources] of needed) {
    const original = articles.get(targetPath);
    if (!original) continue;
    const targetAbs = resolve(root, targetPath);
    const targetDir = dirname(targetAbs);

    const linkLines = [...sources]
      .sort()
      .map((source) => {
        const info = linkMap.get(source);
        if (!info) return `- [[${source}]]`;
        const relP = relative(targetDir, info.absolutePath);
        return `- [${info.displayName}](${relP})`;
      })
      .join('\n');

    const hasSeeAlso = /^## See Also/m.test(original);
    const updated = hasSeeAlso
      ? original.replace(/^(## See Also\n)/m, `$1${linkLines}\n`)
      : original.trimEnd() + `\n\n## See Also\n\n${linkLines}\n`;

    await writeFile(targetAbs, updated, 'utf-8');
    articles.set(targetPath, updated);
    fixLog.info(`Added ${sources.size} backlink(s) to ${targetPath}`);

    for (const source of sources) {
      fixed.push({
        check: 'Missing backlinks',
        severity: 'suggestion',
        message: `Added backlink to ${source} in ${targetPath}`,
        file: targetPath,
        autoFixed: true
      });
    }
  }

  fixLog.info(`Missing backlinks: ${fixed.length} added`);
  return fixed;
}

// ── Run ───────────────────────────────────────────────────────────────

export async function run(opts: LintOptions = {}): Promise<LintSummary> {
  const start = Date.now();
  const fixMode = opts.fixMode ?? false;

  try {
    log.info(`Started${fixMode ? ' (auto-fix enabled)' : ''}`);

    const articles = await readAllWikiContent();
    log.info(`Found ${articles.size} articles`);

    // Structural checks: filesystem-only, sequential for predictable log ordering.
    const checks = await Promise.all([
      checkBrokenLinks(articles),
      checkOrphanPages(articles),
      checkOrphanSources(),
      checkMissingBacklinks(articles),
      checkSparseArticles(articles),
      checkTransientMemoryRefs(articles),
      checkInvalidFrontmatter(articles)
    ]);
    const allIssues = checks.flat();

    log.info(
      `Structural checks: ${checks[0].length} broken, ${checks[1].length} orphan pages, ${checks[2].length} orphan sources, ${checks[3].length} missing backlinks, ${checks[4].length} sparse, ${checks[5].length} transient refs, ${checks[6].length} invalid frontmatter`
    );

    // Auto-fix
    const fixedIssues: LintIssue[] = [];
    if (fixMode) {
      log.info('Running auto-fixes');
      fixedIssues.push(...(await fixWikilinks(articles)));
      fixedIssues.push(...(await fixMissingBacklinks(articles)));
      if (fixedIssues.length === 0) log.info('No auto-fixable issues found');
    }

    // Strip auto-fixed from unfixed list
    const unfixedIssues = fixMode
      ? allIssues.filter((issue) => {
          if (issue.check !== 'Broken links' && issue.check !== 'Missing backlinks') return true;
          return !fixedIssues.some((f) => f.file === issue.file && f.check === issue.check);
        })
      : allIssues;

    // Persist report + state
    const reportPath = resolve(FOLDERS.DATA, 'lint.md');
    await writeFile(reportPath, generateReport(unfixedIssues, fixedIssues), 'utf-8');

    const state = await loadState();
    state.last_lint = nowISO();
    await saveState(state);

    // Log per-issue at appropriate level
    for (const issue of unfixedIssues) {
      const line = `${issue.check}: ${issue.message}`;
      if (issue.severity === 'error') log.error(line);
      else if (issue.severity === 'warning') log.warn(line);
      else log.info(line);
    }
    for (const issue of fixedIssues) {
      log.info(`Auto-fixed — ${issue.check}: ${issue.message}`);
    }

    const errors = unfixedIssues.filter((i) => i.severity === 'error').length;
    const warnings = unfixedIssues.filter((i) => i.severity === 'warning').length;
    const suggestions = unfixedIssues.filter((i) => i.severity === 'suggestion').length;
    const emoji = errors > 0 ? '⚠️' : unfixedIssues.length === 0 ? '✅' : '✨';
    const reportRel = repoRelative(reportPath);
    const message = fixMode
      ? `${emoji} Lint complete. ${unfixedIssues.length} remaining (${fixedIssues.length} auto-fixed). Report: ${reportRel}`
      : `${emoji} Lint complete. ${unfixedIssues.length} issues (${errors} errors, ${warnings} warnings, ${suggestions} suggestions). Report: ${reportRel}`;

    log.info(message);
    return {
      status: 'success',
      duration: Date.now() - start,
      message,
      errors,
      warnings,
      suggestions,
      fixed: fixedIssues.length,
      reportPath
    };
  } catch (err) {
    log.error('Fatal error', err);
    return {
      status: 'error',
      duration: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
      errors: 0,
      warnings: 0,
      suggestions: 0,
      fixed: 0,
      reportPath: resolve(FOLDERS.DATA, 'lint.md')
    };
  }
}

function generateReport(issues: LintIssue[], fixed: LintIssue[] = []): string {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const suggestions = issues.filter((i) => i.severity === 'suggestion').length;

  const lines = [
    `# Knowledge Lint Report`,
    ``,
    `Date: ${nowISO()}`,
    ``,
    `## Summary`,
    ``,
    `- Remaining issues: ${issues.length}`,
    `- Errors: ${errors}`,
    `- Warnings: ${warnings}`,
    `- Suggestions: ${suggestions}`,
    ...(fixed.length ? [`- Auto-fixed: ${fixed.length}`] : []),
    ``
  ];

  const grouped = new Map<string, LintIssue[]>();
  for (const issue of issues) {
    const list = grouped.get(issue.check) ?? [];
    list.push(issue);
    grouped.set(issue.check, list);
  }

  for (const [check, checkIssues] of grouped) {
    lines.push(`## ${check}`, ``);
    for (const issue of checkIssues) {
      const prefix = issue.severity === 'error' ? 'ERROR' : issue.severity === 'warning' ? 'WARN' : 'SUGGESTION';
      lines.push(`- **${prefix}**: ${issue.message}`);
    }
    lines.push(``);
  }

  if (fixed.length) {
    lines.push(`## Auto-Fixed`, ``);
    for (const issue of fixed) lines.push(`- **FIXED**: ${issue.message}`);
    lines.push(``);
  }

  if (issues.length === 0 && fixed.length === 0) {
    lines.push(`All checks passed. Wiki is healthy.`, ``);
  }

  return lines.join('\n');
}

// CLI entrypoint
if (import.meta.main) {
  const opts: LintOptions = { fixMode: process.argv.includes('--fix') };
  const result = await run(opts);
  if (result.status === 'error') process.exit(1);
}
