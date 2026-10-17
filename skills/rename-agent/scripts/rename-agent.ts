#!/usr/bin/env bun
/**
 * Rename the agent across the markdown it reads now, with the rule seed export uses
 * (`shared/agent-name`). A dry run by default: it lists every line it would change, the
 * mentions the rule leaves alone, and custom-skill hits the operator edits by hand.
 * `--apply` writes those lines, sets IDENTITY.md's Name and records the old one in `Formerly`.
 * Dated records (reports, archives, raw inputs) keep the old name.
 *
 * Usage: rename-agent.ts --to <Name> [--from <Name>] [--keep <path>:<line> ...] [--apply] [--home <dir>]
 */
import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const homeFlag = flag('--home');
// The config module resolves the home from AGENT_HOME, so --home is exported first.
if (homeFlag) {
  process.env.AGENT_HOME = resolve(homeFlag);
}
process.env.AGENT_LOG_FILE = 'off';
const { FOLDERS } = await import('../../../mcp-server/src/config');
const { agentHomePath, isAgentHome } = await import('../../../mcp-server/src/shared/env');
const { agentNameIn, FORMERLY_FIELD, formerNamesIn, NAME_FIELD, NAME_RE, renameAgent } =
  await import('../../../mcp-server/src/shared/agent-name');

const fail = (message: string): never => {
  console.error(message);
  process.exit(2);
};

if (!isAgentHome(agentHomePath())) {
  fail(`not an agent home: ${agentHomePath()}`);
}

const IDENTITY_REL = 'IDENTITY.md';
const ROOT_FILES = ['SOUL.md', IDENTITY_REL, 'AGENTS.md', 'USER.md', join('.claude', 'CLAUDE.md')];
const TREES = [join('.claude', 'rules'), 'knowledge', 'projects'];
const SKIPPED = new Set([join('knowledge', 'raw'), join('projects', 'TASKS.md')]);
const MANUAL_TREE = join('.claude', 'skills');

// The entry itself, never a symlink's target: a linked file or folder may be shared beyond this home.
const isFile = (rel: string): boolean =>
  lstatSync(join(FOLDERS.HOME, rel), { throwIfNoEntry: false })?.isFile() ?? false;
const isDir = (rel: string): boolean =>
  lstatSync(join(FOLDERS.HOME, rel), { throwIfNoEntry: false })?.isDirectory() ?? false;

/** The file's text, or null when it isn't clean UTF-8 and a rewrite would mangle it. */
const textOf = (rel: string): string | null => {
  const buf = readFileSync(join(FOLDERS.HOME, rel));
  const text = buf.toString('utf-8');
  return Buffer.from(text, 'utf-8').equals(buf) ? text : null;
};

if (!isFile(IDENTITY_REL)) {
  fail('IDENTITY.md is missing or a symlink; the rename needs the home to own it');
}
const identity = textOf(IDENTITY_REL) ?? fail('IDENTITY.md is not UTF-8; save it as UTF-8, then rerun');
if (!NAME_FIELD.test(identity)) {
  fail('IDENTITY.md has no `**Name:**` line; add one under ## Who, then rerun');
}
const to = flag('--to') ?? fail('--to <name> is required');
if (!NAME_RE.test(to)) {
  fail(`--to "${to}" must match ${NAME_RE} (letters, digits, spaces, hyphens)`);
}
const from = flag('--from') ?? agentNameIn(identity);
if (!NAME_RE.test(from)) {
  fail(`IDENTITY.md's Name "${from}" must match ${NAME_RE}; pass --from <old name>`);
}
if (from === to) {
  fail(`IDENTITY.md already says ${to}; to finish a half-done rename, pass --from <old name>`);
}
const apply = args.includes('--apply');
const kept = new Set(args.flatMap((arg, i) => (arg === '--keep' ? [args[i + 1]] : [])));

interface Hit {
  path: string;
  line: number;
  text: string;
}

/** Every markdown file under `rel`, skipping dot-entries, symlinks and archive folders. */
const walk = (rel: string): string[] => {
  if (SKIPPED.has(rel) || !isDir(rel)) {
    return [];
  }
  // Sorted, so the report reads the same on every filesystem.
  return readdirSync(join(FOLDERS.HOME, rel), { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .sort((left, right) => (left.name < right.name ? -1 : 1))
    .flatMap((entry) => {
      const child = join(rel, entry.name);
      if (entry.isDirectory()) {
        return entry.name === 'archive' ? [] : walk(child);
      }
      return entry.isFile() && entry.name.endsWith('.md') && !SKIPPED.has(child) ? [child] : [];
    });
};

// IDENTITY.md's Name and Formerly lines belong to the identity edit below, never to the sweep or a keep.
const isIdentityField = (line: string): boolean => NAME_FIELD.test(line) || FORMERLY_FIELD.test(line);

const scan = (rels: string[]): (Hit & { renameable: boolean })[] =>
  rels.flatMap((rel) => {
    // Forward slashes on every OS, so `--keep` paths read the same everywhere.
    const path = rel.split(sep).join('/');
    return (textOf(rel) ?? '')
      .split('\n')
      .flatMap((line, i) =>
        line.includes(from) && !(path === IDENTITY_REL && isIdentityField(line))
          ? [{ path, line: i + 1, text: line.trim(), renameable: renameAgent(line, from, to) !== line }]
          : []
      );
  });

const found = scan([...ROOT_FILES.filter(isFile), ...TREES.flatMap(walk)]);
const key = (hit: Hit): string => `${hit.path}:${hit.line}`;
const strip = ({ path, line, text }: Hit): Hit => ({ path, line, text });
const hits = found.filter((hit) => hit.renameable && !kept.has(key(hit))).map(strip);
// Oldest first; renaming back to an old name takes it off the list.
const formerly = [...formerNamesIn(identity).filter((name) => name !== from && name !== to), from];
const report = {
  mode: apply ? 'applied' : 'dry-run',
  from,
  to,
  // Written whatever the sweep finds, so a leftover `{{AGENT_NAME}}` is repaired too.
  identity: { name: `${agentNameIn(identity)} → ${to}`, formerly: formerly.join(', ') },
  totals: { files: new Set(hits.map((hit) => hit.path)).size, lines: hits.length },
  hits,
  kept: found.filter((hit) => hit.renameable && kept.has(key(hit))).map(strip),
  // Mentions inside a path, identifier or longer word: the rule leaves them, the review should see them.
  guarded: found.filter((hit) => !hit.renameable).map(strip),
  // Custom skills are the operator's code; list them, never write them.
  manual: scan(walk(MANUAL_TREE)).map(strip),
  unknownKeeps: [...kept].filter((entry) => !found.some((hit) => hit.renameable && key(hit) === entry))
};

if (!apply) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}
if (report.unknownKeeps.length > 0) {
  fail(
    `--keep matched no renameable line: ${report.unknownKeeps.join(', ')}; rerun the dry run for current line numbers`
  );
}

/** Write `path` only when `edit` changes it; true when it did. */
const rewrite = (path: string, edit: (text: string) => string): boolean => {
  const abs = join(FOLDERS.HOME, path);
  const original = readFileSync(abs, 'utf-8');
  const next = edit(original);
  if (next !== original) {
    writeFileSync(abs, next);
  }
  return next !== original;
};

const hitLines = new Set(hits.map(key));
const withIdentity = (text: string): string => {
  const withName = text.replace(NAME_FIELD, `$1 ${to}`);
  const formerlyLine = `- **Formerly:** ${formerly.join(', ')}`;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return FORMERLY_FIELD.test(withName)
    ? withName.replace(FORMERLY_FIELD, formerlyLine)
    : withName.replace(NAME_FIELD, `$&${eol}${formerlyLine}`);
};
// One planned edit per file, IDENTITY.md's sweep and field edit together, each written once.
const changed = [...new Set([IDENTITY_REL, ...hits.map((hit) => hit.path)])].filter((path) =>
  rewrite(path, (text) => {
    const swept = text
      .split('\n')
      .map((line, i) => (hitLines.has(`${path}:${i + 1}`) ? renameAgent(line, from, to) : line))
      .join('\n');
    return path === IDENTITY_REL ? withIdentity(swept) : swept;
  })
);

console.log(
  JSON.stringify(
    {
      ...report,
      changed
    },
    null,
    2
  )
);
