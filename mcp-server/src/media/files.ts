import { BROWSER } from '@/config';
import { expandTilde, isInside } from '@/shared/paths';
import { slugify } from '@/tasks/mutate';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolve a media path given as absolute, relative, `~`-prefixed, or a `file://` URL. */
export const resolveMediaPath = (input: string): string => {
  if (input.startsWith('file://')) {
    return fileURLToPath(input);
  }
  const expanded = expandTilde(input);
  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
};

/** Human timestamp label, mm:ss. */
export const label = (seconds: number): string => {
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

/** A fresh `<parent>/<stamp>-<name>` path (not created), with `name` reduced to a safe slug. */
export const stampedPath = (parent: string, name: string): string =>
  resolve(parent, `${new Date().toISOString().replace(/[:.]/g, '-')}-${slugify(name)}`);

/** Resolve a caller-supplied folder, refusing anything outside the captures dir. */
export const insideCaptures = (dir: string): string => {
  const abs = resolveMediaPath(dir);
  if (abs === BROWSER.CAPTURES_DIR || !isInside(abs, BROWSER.CAPTURES_DIR)) {
    throw new Error(`Folder must be inside ${BROWSER.CAPTURES_DIR}: ${abs}`);
  }
  return abs;
};
