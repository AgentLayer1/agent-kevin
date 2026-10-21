import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HELPDESKS, type HelpdeskName } from "../../../mcp-server/src/helpdesk/types";
import { isoWeekOf } from "../../../mcp-server/src/tasks/horizon";
import { frontmatterOf } from "../../tax/scripts/calendar";

/**
 * Queue profiles: `projects/<slug>/helpdesk.md`, one per support queue, written by the operator.
 * Flat frontmatter is what code reads (helpdesk, statuses, cadence); the body is triage rules
 * and tone for the model.
 */

export const PROFILE_FILE = "helpdesk.md";
export const CADENCES = ["daily", "weekly", "monthly"] as const;
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

const isHelpdesk = (value: unknown): value is HelpdeskName => HELPDESKS.some((name) => name === value);
const isCadence = (value: unknown): value is Cadence => CADENCES.some((name) => name === value);

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim() !== "");

export const parseProfile = (file: string, slug: string, raw: string): QueueProfile => {
  const data = frontmatterOf(raw);
  if (!data) {
    throw new Error(`${file}: no frontmatter; it needs at least statuses: [<status>, …]`);
  }
  const nested = Object.entries(data).filter(
    ([, value]) => (typeof value === "object" && value !== null && !Array.isArray(value)) || (Array.isArray(value) && value.some((item) => typeof item === "object"))
  );
  if (nested.length > 0) {
    throw new Error(`${file}: frontmatter values must be flat (${nested.map(([key]) => key).join(", ")})`);
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

export const profileSlugs = (projectsDir: string): string[] =>
  (existsSync(projectsDir) ? readdirSync(projectsDir) : []).filter((slug) => existsSync(join(projectsDir, slug, PROFILE_FILE))).sort();

export const loadProfile = (projectsDir: string, slug: string): QueueProfile => {
  const file = join(projectsDir, slug, PROFILE_FILE);
  return parseProfile(file, slug, readFileSync(file, "utf8"));
};

/** The report_write slug a pulse for this queue uses; its files are the cadence watermark. */
export const pulseSlug = (slug: string): string => `pulse-${slug}`;

/** The date of the newest pulse report for a queue, from `YYYY-MM-DD-HHMM-pulse-<slug>[-N].md`. */
export const lastPulse = (reportsDir: string, slug: string): string | null => {
  const pattern = new RegExp(`^(\\d{4}-\\d{2}-\\d{2})-\\d{4}-${pulseSlug(slug).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(-\\d+)?\\.md$`);
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
