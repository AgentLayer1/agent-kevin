import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HELPDESKS, type HelpdeskName } from "../../../mcp-server/src/helpdesk/types";
import { isoWeekOf } from "../../../mcp-server/src/tasks/horizon";

/**
 * Queue profiles: `projects/<slug>/helpdesk.md`, one per support queue, written by the operator.
 * Flat frontmatter is what code reads (helpdesk, statuses, cadence); the body is triage rules
 * and tone for the model.
 */

const PROFILE_FILE = "helpdesk.md";
const CADENCES = ["daily", "weekly", "monthly"] as const;
export type Cadence = (typeof CADENCES)[number];

export interface QueueProfile {
  slug: string;
  helpdesk?: HelpdeskName;
  statuses: string[];
  cadence?: Cadence;
}

export interface PulseDue {
  invoke: string;
  label: string;
  lastRun: string | null;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const frontmatterOf = (raw: string): Record<string, unknown> | null => {
  const block = raw.match(FRONTMATTER_RE)?.[1];
  const data: unknown = block === undefined ? null : Bun.YAML.parse(block);
  return isRecord(data) ? data : null;
};

const isHelpdesk = (value: unknown): value is HelpdeskName => HELPDESKS.some((name) => name === value);
const isCadence = (value: unknown): value is Cadence => CADENCES.some((name) => name === value);

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim() !== "");

export const parseProfile = (file: string, slug: string, raw: string): QueueProfile => {
  const data = frontmatterOf(raw);
  if (!data) {
    throw new Error(`${file}: no frontmatter; it needs at least statuses: [<status>, …]`);
  }
  const { helpdesk, statuses, cadence } = data;
  if (helpdesk !== undefined && !isHelpdesk(helpdesk)) {
    throw new Error(`${file}: helpdesk must be one of ${HELPDESKS.join(", ")}`);
  }
  if (!isStringList(statuses)) {
    throw new Error(`${file}: statuses must list the status names the pulse keeps, as the helpdesk names them`);
  }
  if (cadence !== undefined && !isCadence(cadence)) {
    throw new Error(`${file}: cadence must be one of ${CADENCES.join(", ")}`);
  }
  return {
    slug,
    ...(isHelpdesk(helpdesk) && { helpdesk }),
    statuses,
    ...(isCadence(cadence) && { cadence }),
  };
};

const profileSlugs = (projectsDir: string): string[] =>
  (existsSync(projectsDir) ? readdirSync(projectsDir) : []).filter((slug) => existsSync(join(projectsDir, slug, PROFILE_FILE))).sort();

const loadProfile = (projectsDir: string, slug: string): QueueProfile => {
  const file = join(projectsDir, slug, PROFILE_FILE);
  return parseProfile(file, slug, readFileSync(file, "utf8"));
};

/** The date of the newest pulse report for a queue: report_write names it `YYYY-MM-DD-HHMM-pulse-<slug>.md`. */
export const lastPulse = (reportsDir: string, slug: string): string | null => {
  const pattern = new RegExp(`^(\\d{4}-\\d{2}-\\d{2})-\\d{4}-pulse-${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.md$`);
  const dates = (existsSync(reportsDir) ? readdirSync(reportsDir) : [])
    .map((name) => name.match(pattern)?.[1])
    .filter((date): date is string => date !== undefined)
    .sort();
  return dates.at(-1) ?? null;
};

const BUCKETS: Record<Cadence, (date: string) => string> = {
  daily: (date) => date,
  weekly: isoWeekOf,
  monthly: (date) => date.slice(0, 7),
};

/**
 * Every queue whose cadence has no pulse in the current day, ISO week or month. A profile that
 * fails to parse comes back as its own item, so one bad file never hides the others.
 */
export const pulsesDue = (projectsDir: string, reportsDir: string, today: string): PulseDue[] =>
  profileSlugs(projectsDir).flatMap((slug): PulseDue[] => {
    try {
      const { cadence } = loadProfile(projectsDir, slug);
      if (!cadence) {
        return [];
      }
      const last = lastPulse(reportsDir, slug);
      const bucket = BUCKETS[cadence];
      return last !== null && bucket(last) === bucket(today) ? [] : [{ invoke: `helpdesk pulse ${slug}`, label: `Helpdesk pulse: ${slug} (${cadence})`, lastRun: last }];
    } catch (error) {
      return [{ invoke: `helpdesk profile ${slug}`, label: `Fix the helpdesk profile: ${error instanceof Error ? error.message : String(error)}`, lastRun: null }];
    }
  });
