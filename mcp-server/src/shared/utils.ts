import { FOLDERS } from '@/config';
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'fs';
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

/**
 * Atomic write: serialise to a sibling `.tmp` file, then rename. A crash
 * between write and rename leaves the previous file intact.
 */
export function writeFileAtomic(path: string, content: string | Uint8Array, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, content);
  if (mode !== undefined) chmodSync(tmp, mode);
  renameSync(tmp, path);
}

/** Atomic JSON write — thin wrapper over `writeFileAtomic`. */
export function writeJsonAtomic(path: string, value: unknown, mode?: number): void {
  writeFileAtomic(path, JSON.stringify(value, null, 2), mode);
}
