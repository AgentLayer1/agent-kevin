/**
 * A home's two Claude settings files. `settings.json` is shared: committed, synced and seeded, so it
 * holds the agent's policy and defaults. `settings.local.json` is this machine's. Lists merge across
 * the two and a local scalar wins. A leaf on purpose (node builtins only), so skill scripts can
 * import it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A settings file as an object: `{}` when absent, and a throw when it is not a JSON object. */
const readSettingsFile = (path: string): Json => {
  if (!existsSync(path)) {
    return {};
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  if (!isObject(parsed)) {
    throw new Error(`${path} is not a JSON object`);
  }
  return parsed;
};

/** Both files and the view Claude Code acts on: lists combined, a local scalar or object over the shared one. */
export const readMergedSettings = (home: string): { shared: Json; merged: Json } => {
  const shared = readSettingsFile(join(home, '.claude', 'settings.json'));
  const local = readSettingsFile(join(home, '.claude', 'settings.local.json'));
  return { shared, merged: mergeSettings(shared, local) };
};

/** Keys Claude Code replaces whole rather than merging: the status line, and one marketplace's entry. */
const replacedWhole = (key: string, parent: string | undefined): boolean =>
  key === 'statusLine' || parent === 'extraKnownMarketplaces';

export const mergeSettings = (lower: Json, higher: Json, parent?: string): Json =>
  Object.fromEntries(
    [...new Set([...Object.keys(lower), ...Object.keys(higher)])].map((key) => {
      const [under, over] = [lower[key], higher[key]];
      if (over === undefined) {
        return [key, under];
      }
      if (Array.isArray(under) && Array.isArray(over)) {
        return [key, [...under, ...over.filter((entry) => !under.includes(entry))]];
      }
      return [
        key,
        isObject(under) && isObject(over) && !replacedWhole(key, parent) ? mergeSettings(under, over, key) : over
      ];
    })
  );
