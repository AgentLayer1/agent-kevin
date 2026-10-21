import { FOLDERS } from '@/config';
import { existingTarget } from '@/shared/paths';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'fs';
import { dirname, relative } from 'path';

// ── Async helpers ─────────────────────────────────────────────────────

/** `run` over `items`, `size` at a time, in order: a cap on how many requests one call puts in flight. */
export const inChunks = async <T, R>(items: readonly T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> => {
  const chunks = Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
  return chunks.reduce<Promise<R[]>>(async (done, chunk) => [...(await done), ...(await Promise.all(chunk.map(run)))], Promise.resolve([]));
};

// ── Path helpers ──────────────────────────────────────────────────────

/**
 * Render a path as repo-root-relative so user-facing output never leaks
 * `/Users/<name>/Documents/...` absolute paths. Paths already outside the
 * repo root are returned unchanged — better than producing a `../../foo`
 * trail.
 */
export function repoRelative(absolutePath: string): string {
  const rel = relative(FOLDERS.ROOT, absolutePath);
  return rel.startsWith('..') || rel === '' ? absolutePath : rel;
}

// ── Filesystem helpers ────────────────────────────────────────────────

/**
 * Atomic write: serialise to a uniquely named sibling temp file, then rename. A crash leaves the
 * previous file intact, and concurrent writers never share a temp file.
 */
export function writeFileAtomic(path: string, content: string | Uint8Array, mode?: number): void {
  // A symlinked file (settings kept in a dotfiles repo) is written through, never replaced by a copy.
  const target = existingTarget(path);
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, content);
    if (mode !== undefined) {
      chmodSync(tmp, mode);
    }
    renameSync(tmp, target);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

export const countOf = (count: number, unit: string): string => `${count} ${unit}${count === 1 ? '' : 's'}`;

/** Atomic JSON write — thin wrapper over `writeFileAtomic`. */
export function writeJsonAtomic(path: string, value: unknown, mode?: number): void {
  writeFileAtomic(path, JSON.stringify(value, null, 2), mode);
}
