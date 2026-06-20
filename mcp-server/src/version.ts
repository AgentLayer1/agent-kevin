/**
 * Version + upgrade-state logic, shared by the SessionStart banner (context.ts)
 * and the dashboard (status/collect.ts).
 *
 * The HOME records which template version it's on in `<HOME>/.kevin/version.json`
 * (written by `/init` for fresh homes, by `/agent-kevin:upgrade` thereafter).
 * Comparing that baseline against the installed plugin version (plugin.json) is
 * a purely LOCAL, zero-network signal for "are HOME migrations pending?". The
 * CHANGELOG.md at the plugin root is the human + machine contract describing what
 * each release's upgrade entails.
 */
import { FILES, FOLDERS, PLUGIN_VERSION, isInitialized } from '@/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** A single machine-actionable line from a release's `### Upgrade` block,
 *  shaped `` - `<kind>: <severity>` — <note> ``. */
export interface UpgradeAction {
  /** `deps` | `settings` | `template/<file>` | `file` | `manual`. */
  kind: string;
  /** `required` | `mandatory` | `optional` | `additive` | `none`. */
  severity: string;
  note: string;
}

export interface ChangelogSection {
  /** `Added` | `Changed` | `Fixed` | `Removed` | … */
  heading: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  /** `YYYY-MM-DD`, or '' if the heading omitted a date. */
  date: string;
  sections: ChangelogSection[];
  /** Parsed `### Upgrade` action lines (empty for code-only releases). */
  upgrade: UpgradeAction[];
  /** Raw text of the `### Upgrade` block, for verbatim display + the skill. */
  upgradeRaw: string;
}

export type UpgradeState = 'current' | 'pending' | 'onboard';

export interface UpgradeStatus {
  state: UpgradeState;
  /** HOME template baseline, or null when no version.json exists. */
  baseline: string | null;
  /** Installed plugin version (plugin.json). */
  installed: string;
  /** Released versions in `(baseline, installed]` per the CHANGELOG. */
  releasesBehind: number;
}

const SEMVER_RE = /^\s*v?(\d+)\.(\d+)\.(\d+)/;

/** Numeric semver compare (pre-release/build suffixes ignored). Non-parseable
 *  inputs sort as 0.0.0. Returns -1 | 0 | 1. */
export const compareSemver = (a: string, b: string): number => {
  const parts = (v: string): [number, number, number] => {
    const m = v.match(SEMVER_RE);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  };
  const [a0, a1, a2] = parts(a);
  const [b0, b1, b2] = parts(b);
  return Math.sign(a0 - b0 || a1 - b1 || a2 - b2);
};

interface VersionFile {
  templateVersion?: string;
}

/** HOME template baseline from `<HOME>/.kevin/version.json`, or null when the
 *  file is missing/unreadable (a pre-feature or uninitialized home). */
export const readHomeBaseline = (): string | null => {
  try {
    const parsed: VersionFile = JSON.parse(readFileSync(FILES.VERSION, 'utf-8'));
    return typeof parsed.templateVersion === 'string' ? parsed.templateVersion : null;
  } catch {
    return null;
  }
};

/** `- `kind: severity` — note` → an UpgradeAction; null for non-action lines
 *  (e.g. the "None — code-only" sentinel or prose). */
const parseUpgradeLine = (line: string): UpgradeAction | null => {
  const m = line.match(/^[-*]\s+`([^`:]+):\s*([^`]+)`\s*(?:[—:-]\s*(.*))?$/);
  if (!m) return null;
  return { kind: m[1].trim(), severity: m[2].trim().toLowerCase(), note: (m[3] ?? '').trim() };
};

const CHANGELOG_PATH = resolve(FOLDERS.ROOT, 'CHANGELOG.md');

/** Parse the plugin-root CHANGELOG.md into structured entries, newest first.
 *  Best-effort: a missing/garbled file yields []. */
export const parseChangelog = (): ChangelogEntry[] => {
  let raw: string;
  try {
    raw = readFileSync(CHANGELOG_PATH, 'utf-8');
  } catch {
    return [];
  }

  const lines = raw.split('\n');
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  let sub: ChangelogSection | null = null;
  let inUpgrade = false;

  const flushSub = () => {
    if (current && sub && sub.items.length) current.sections.push(sub);
    sub = null;
  };

  for (const line of lines) {
    const release = line.match(/^##\s+\[?(\d+\.\d+\.\d+[^\]\s]*)\]?(?:\s*[-–]\s*(\S+))?/);
    if (release) {
      flushSub();
      if (current) entries.push(current);
      current = { version: release[1], date: release[2] ?? '', sections: [], upgrade: [], upgradeRaw: '' };
      inUpgrade = false;
      continue;
    }
    if (!current) continue;

    const heading = line.match(/^###\s+(.+?)\s*$/);
    if (heading) {
      flushSub();
      inUpgrade = /^upgrade$/i.test(heading[1].trim());
      sub = inUpgrade ? null : { heading: heading[1].trim(), items: [] };
      continue;
    }

    if (inUpgrade) {
      current.upgradeRaw += (current.upgradeRaw ? '\n' : '') + line;
      const action = parseUpgradeLine(line.trim());
      if (action) current.upgrade.push(action);
      continue;
    }

    const item = line.match(/^[-*]\s+(.*)$/);
    if (item && sub) sub.items.push(item[1].trim());
  }
  flushSub();
  if (current) entries.push(current);

  for (const entry of entries) entry.upgradeRaw = entry.upgradeRaw.trim();
  return entries;
};

/**
 * Local, zero-network upgrade signal.
 * - `current`  — baseline == installed (or a fresh home not yet `/init`-ed).
 * - `pending`  — baseline < installed; HOME migrations from the CHANGELOG await.
 * - `onboard`  — an established home (SOUL.md present) with no version.json yet;
 *                run `/agent-kevin:upgrade` once to start tracking.
 */
export const getUpgradeStatus = (): UpgradeStatus => {
  const installed = PLUGIN_VERSION;
  const baseline = readHomeBaseline();

  if (baseline === null) {
    return { state: isInitialized() ? 'onboard' : 'current', baseline: null, installed, releasesBehind: 0 };
  }
  if (compareSemver(baseline, installed) >= 0) {
    return { state: 'current', baseline, installed, releasesBehind: 0 };
  }
  const behind = parseChangelog().filter(
    (entry) => compareSemver(entry.version, baseline) > 0 && compareSemver(entry.version, installed) <= 0
  ).length;
  return { state: 'pending', baseline, installed, releasesBehind: behind || 1 };
};
