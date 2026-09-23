#!/usr/bin/env bun
/**
 * Bytes the agent home loads into every session, per host: Claude Code reads the bridge, what it
 * `@`-imports (recursively, prose only, never inside code), and the unscoped rule files; Codex
 * reads AGENTS.md natively and gets the identity stack from the SessionStart hook. An import that
 * does not resolve is listed and fails the run, so a partial total is never mistaken for a
 * baseline. Read-only.
 *
 * Usage: context-weight.ts [--home <dir>]   (else the agent's home variable, else the cwd)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { agentKeyName } from '../../../mcp-server/src/shared/naming';

const args = process.argv.slice(2);
const homeFlag = args.indexOf('--home') === -1 ? undefined : args[args.indexOf('--home') + 1];
// The config module resolves the home from the agent's own variable, so an explicit --home is
// exported under that name before the module loads; a fork with another prefix still works.
if (homeFlag) process.env[agentKeyName('HOME')] = resolve(homeFlag);
const { FILES, FOLDERS, staticContextFiles } = await import('../../../mcp-server/src/config');
const { agentHomePath, isAgentHome } = await import('../../../mcp-server/src/shared/env');

const home = agentHomePath();
if (!isAgentHome(home)) {
  console.error(`not an agent home: ${home}`);
  process.exit(2);
}

interface Stack {
  files: { path: string; bytes: number }[];
  total: number;
  unresolved: string[];
  absent: string[];
}

const IMPORT_DEPTH = 5;
/** `@path` tokens in prose, as Claude Code reads them: fenced blocks (backtick or tilde, three or
 *  more, up to three spaces indented, an unclosed one running to the end) and code spans are not imports. A token that resolves to a file is an import whatever it looks like
 *  (`@README`); one that does not resolve is an import only when it looks like a path, so a bare
 *  word such as `@Observable` in a task title is a mention rather than an unresolved import. */
const importsOf = (path: string): string[] => {
  const prose = readFileSync(path, 'utf-8')
    .replace(/\r\n/g, '\n')
    .replace(/^ {0,3}(([`~])\2{2,})[^\n]*\n[\s\S]*?^ {0,3}\1\2*[ \t]*$/gm, '')
    .replace(/^ {0,3}([`~])\1{2,}[\s\S]*$/m, '')
    .replace(/`[^`\n]*`/g, '');
  return [...prose.matchAll(/(?:^|[\s(\[])@([^\s`]+)/g)]
    .map((match) => match[1].replace(/[.,;:)\]]+$/, ''))
    .map((target) => ({
      target,
      resolved: target.startsWith('~/') ? join(homedir(), target.slice(2)) : isAbsolute(target) ? target : resolve(dirname(path), target)
    }))
    .filter(({ target, resolved }) => existsSync(resolved) || /[/.~]/.test(target))
    .map(({ resolved }) => resolved);
};

/** A rule is scoped when its leading YAML frontmatter has a top-level `paths` key; frontmatter
 *  that does not parse scopes nothing, so the file counts as always loaded. */
const isScoped = (text: string): boolean => {
  const normalised = text.replace(/\r\n/g, '\n');
  if (!normalised.startsWith('---\n')) return false;
  const frontmatter = normalised.slice(4).split('\n---')[0];
  try {
    const parsed: unknown = Bun.YAML.parse(frontmatter);
    return typeof parsed === 'object' && parsed !== null && 'paths' in parsed;
  } catch {
    return false;
  }
};

const unscopedRules = (): string[] => {
  const dir = join(home, '.claude', 'rules');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf-8' })
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(dir, name))
    .filter((path) => !isScoped(readFileSync(path, 'utf-8')));
};

const stack = (roots: string[], followImports: boolean): Stack => {
  const seen = new Set<string>();
  const unresolved: string[] = [];
  const visit = (path: string, depth: number) => {
    if (seen.has(path)) return;
    if (!existsSync(path)) {
      unresolved.push(path);
      return;
    }
    seen.add(path);
    if (followImports && depth < IMPORT_DEPTH) importsOf(path).forEach((target) => visit(target, depth + 1));
  };
  const absent = roots.filter((root) => !followImports && !existsSync(root));
  roots.filter((root) => !absent.includes(root)).forEach((root) => visit(root, 0));
  const files = [...seen].map((path) => ({ path, bytes: statSync(path).size }));
  return { files, total: files.reduce((sum, file) => sum + file.bytes, 0), unresolved, absent };
};

const claude = stack([FILES.CLAUDE, ...unscopedRules()], true);
// The Codex hook skips a static file that is missing, so an absent one is reported, not an error.
const codex = stack([FILES.AGENTS, ...staticContextFiles()], false);
process.stdout.write(`${JSON.stringify({ home: FOLDERS.HOME, claude, codex }, null, 2)}\n`);
if (claude.unresolved.length > 0) process.exit(1);
