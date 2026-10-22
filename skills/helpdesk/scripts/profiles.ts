import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { STOREFRONTS } from "../../../mcp-server/src/appstore/storefronts";
import { HELPDESKS, type HelpdeskName } from "../../../mcp-server/src/helpdesk/types";
import { isoWeekOf } from "../../../mcp-server/src/tasks/horizon";

/**
 * Queue profiles: `projects/<slug>/helpdesk.md`, one per support queue, written by the operator.
 * Flat frontmatter is what code reads (helpdesk, connection, statuses, schedule, and the App Store
 * app and storefronts a pulse reads reviews for); the body is the
 * queue's own workflow, rules and context for the model.
 */

const PROFILE_FILE = "helpdesk.md";
const CADENCES = ["daily", "weekly", "monthly"] as const;
export type Cadence = (typeof CADENCES)[number];
/** Playbook names a profile workflow can't take; `pulse` is scheduled by name and extended in place. */
const BUILT_INS = ["ticket", "account", "draft", "raise", "bug", "setup", "help", "workflow", "stats"];
/** No hyphens, so `<routine>-<slug>` in a report name reads one way only. */
const ROUTINE_RE = /^[a-z][a-z0-9]*$/;

export interface Scheduled {
  routine: string;
  cadence: Cadence;
}

export interface QueueProfile {
  slug: string;
  helpdesk?: HelpdeskName;
  connection?: string;
  statuses: string[];
  schedule: Scheduled[];
  /** The App Store app id whose reviews the pulse reads. */
  appstore?: string;
  /** Storefronts to pin the review read to; absent lets the reviews tool choose. */
  storefronts?: string[];
}

export interface RoutineDue {
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

/** The routines a profile's body defines, one per `## Workflow: <name>` heading, each named so `/helpdesk <name>` reaches it. */
const parseWorkflows = (file: string, raw: string): string[] =>
  [...raw.matchAll(/^## Workflow:\s*(\S+)\s*$/gim)].map((match) => {
    const name = (match[1] ?? "").toLowerCase();
    if (!ROUTINE_RE.test(name) || name === "pulse" || BUILT_INS.includes(name)) {
      throw new Error(`${file}: "## Workflow: ${name}" needs a name of letters and digits that isn't pulse, ${BUILT_INS.join(", ")}`);
    }
    return name;
  });

const parseSchedule = (file: string, workflows: readonly string[], value: unknown): Scheduled[] => {
  if (value === undefined) {
    return [];
  }
  if (!isStringList(value)) {
    throw new Error(`${file}: schedule must list <routine>:<cadence> entries, such as [pulse:weekly]`);
  }
  return value.map((entry): Scheduled => {
    const [routine = "", cadence] = entry.trim().toLowerCase().split(":");
    if (!isCadence(cadence)) {
      throw new Error(`${file}: schedule entry "${entry}" needs a cadence of ${CADENCES.join(", ")}`);
    }
    if (!ROUTINE_RE.test(routine) || BUILT_INS.includes(routine)) {
      throw new Error(`${file}: schedule entry "${entry}" needs a routine name of letters and digits that isn't ${BUILT_INS.join(", ")}`);
    }
    if (routine !== "pulse" && !workflows.includes(routine)) {
      throw new Error(`${file}: schedule names "${routine}", but there is no "## Workflow: ${routine}" section`);
    }
    return { routine, cadence };
  });
};

const parseAppStore = (file: string, value: unknown): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const id = typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(id)) {
    throw new Error(`${file}: appstore must be the app's numeric App Store id (the digits after "id" in its link)`);
  }
  return id;
};

const parseStorefronts = (file: string, value: unknown, appstore: string | undefined): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (appstore === undefined) {
    throw new Error(`${file}: storefronts needs appstore, the app they belong to`);
  }
  const codes = isStringList(value) ? value.map((code) => code.trim().toLowerCase()) : [];
  if (codes.length === 0 || !codes.every((code) => STOREFRONTS.includes(code))) {
    throw new Error(`${file}: storefronts must list App Store storefront codes, such as [us, gb], or be left out`);
  }
  return codes;
};

export const parseProfile = (file: string, slug: string, raw: string): QueueProfile => {
  const data = frontmatterOf(raw);
  if (!data) {
    throw new Error(`${file}: no frontmatter; it needs at least statuses: [<status>, …]`);
  }
  const { helpdesk, connection, statuses, schedule } = data;
  const appstore = parseAppStore(file, data.appstore);
  const storefronts = parseStorefronts(file, data.storefronts, appstore);
  if (helpdesk !== undefined && !isHelpdesk(helpdesk)) {
    throw new Error(`${file}: helpdesk must be one of ${HELPDESKS.join(", ")}`);
  }
  if (connection !== undefined && (typeof connection !== "string" || connection.trim() === "")) {
    throw new Error(`${file}: connection must be a connection name, or left out for the default`);
  }
  if (!isStringList(statuses)) {
    throw new Error(`${file}: statuses must list the status names the pulse keeps, as the helpdesk names them`);
  }
  return {
    slug,
    ...(isHelpdesk(helpdesk) && { helpdesk }),
    ...(typeof connection === "string" && { connection: connection.trim() }),
    statuses,
    schedule: parseSchedule(file, parseWorkflows(file, raw), schedule),
    ...(appstore && { appstore }),
    ...(storefronts && { storefronts }),
  };
};

const profileSlugs = (projectsDir: string): string[] =>
  (existsSync(projectsDir) ? readdirSync(projectsDir) : []).filter((slug) => existsSync(join(projectsDir, slug, PROFILE_FILE))).sort();

const loadProfile = (projectsDir: string, slug: string): QueueProfile => {
  const file = join(projectsDir, slug, PROFILE_FILE);
  return parseProfile(file, slug, readFileSync(file, "utf8"));
};

/** The date of a routine's newest report for a queue: report_write names it `YYYY-MM-DD-HHMM-<routine>-<slug>.md`. */
export const lastRun = (reportsDir: string, routine: string, slug: string): string | null => {
  const pattern = new RegExp(`^(\\d{4}-\\d{2}-\\d{2})-\\d{4}-${routine}-${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.md$`);
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
 * Every scheduled routine with no report in its current day, ISO week or month. A profile that
 * fails to parse comes back as its own item, so one bad file never hides the others.
 */
export const routinesDue = (projectsDir: string, reportsDir: string, today: string): RoutineDue[] =>
  profileSlugs(projectsDir).flatMap((slug): RoutineDue[] => {
    try {
      return loadProfile(projectsDir, slug).schedule.flatMap(({ routine, cadence }): RoutineDue[] => {
        const last = lastRun(reportsDir, routine, slug);
        const bucket = BUCKETS[cadence];
        return last !== null && bucket(last) === bucket(today)
          ? []
          : [{ invoke: `helpdesk ${routine} ${slug}`, label: `Helpdesk ${routine}: ${slug} (${cadence})`, lastRun: last }];
      });
    } catch (error) {
      return [{ invoke: `helpdesk setup ${slug}`, label: `Fix the helpdesk profile: ${error instanceof Error ? error.message : String(error)}`, lastRun: null }];
    }
  });
