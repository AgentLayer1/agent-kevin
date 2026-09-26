import { FOLDERS } from '@/config';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'fs';
import { dirname, relative } from 'path';

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

const existingTarget = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

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

/** Atomic JSON write — thin wrapper over `writeFileAtomic`. */
export function writeJsonAtomic(path: string, value: unknown, mode?: number): void {
  writeFileAtomic(path, JSON.stringify(value, null, 2), mode);
}
