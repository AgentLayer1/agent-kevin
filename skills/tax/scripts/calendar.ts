#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { FOLDERS } from "../../../mcp-server/src/config";
import { todayDate } from "../../../mcp-server/src/shared/date";
import { parseFrontmatter } from "../../../mcp-server/src/tasks/schema";

/**
 * Deadline engine for the tax skill. Reads entity profiles from <projects>/tax/entities/*.md,
 * expands each obligation into dated occurrences, matches them against existing tasks by their
 * `obl:` label, and renders <projects>/tax/dashboard.html. Never creates tasks itself.
 *
 * Usage: bun calendar.ts plan [--today YYYY-MM-DD]       prints { missing, existing, pendingCloses }
 *        bun calendar.ts liability [--today YYYY-MM-DD]  prints each entity's tax position
 *        bun calendar.ts render [--today YYYY-MM-DD]     writes dashboard.html, prints its path
 */

export const DueFrom = { Start: "start", End: "end" } as const;
export type DueFrom = (typeof DueFrom)[keyof typeof DueFrom];

export type Due =
  | { from: DueFrom; months: number; day: number | "last" }
  | { from: DueFrom; days: number };

export interface Period {
  months: 1 | 2 | 3 | 6 | 12;
  anchor: number | "fye";
}

export interface Obligation {
  id: string;
  title: string;
  period: Period;
  due: Due;
  lead?: number;
  from?: string;
  until?: string;
  note?: string;
  source?: string;
}

export const EntityKind = { Company: "company", Individual: "individual" } as const;
export type EntityKind = (typeof EntityKind)[keyof typeof EntityKind];

export interface Entity {
  slug: string;
  name: string;
  kind: EntityKind;
  country: string;
  fye: string;
  close: "monthly" | "none";
  sme: boolean;
  resident: boolean | null;
  spouseRelief: boolean | null;
  childrenUnder18: number | null;
  obligations: Obligation[];
}

export interface Occurrence {
  entity: string;
  entityName: string;
  obligation: string;
  title: string;
  period: string;
  due: string;
  label: string;
  note?: string;
  source?: string;
}

export const TaskState = {
  Done: "done",
  Skipped: "skipped",
  Open: "open",
  Overdue: "overdue",
  Upcoming: "upcoming",
} as const;
export type TaskState = (typeof TaskState)[keyof typeof TaskState];

export interface ExistingTask {
  id: string;
  label: string;
  status: string;
}

export interface Plan {
  today: string;
  missing: Occurrence[];
  existing: ExistingTask[];
  pendingCloses: PendingClose[];
}

export interface PendingClose {
  entity: string;
  month: string;
}

const DEFAULT_LEAD_DAYS = 21;
const MONTHS_AROUND = 36;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const OBLIGATIONS_RE = /^## Obligations[^\n]*\n(?:(?!^## )[\s\S])*?^```ya?ml\r?\n([\s\S]*?)^```/m;

const pad = (n: number): string => String(n).padStart(2, "0");
const lastDayOf = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();
const monthIndex = (year: number, month: number): number => year * 12 + (month - 1);
const fromIndex = (index: number): { year: number; month: number } => ({
  year: Math.floor(index / 12),
  month: (index % 12) + 1,
});
const monthKey = (index: number): string => {
  const { year, month } = fromIndex(index);
  return `${year}-${pad(month)}`;
};

const dateOf = (index: number, day: number | "last"): string => {
  const { year, month } = fromIndex(index);
  const last = lastDayOf(year, month);
  const resolved = day === "last" ? last : Math.min(day, last);
  return `${year}-${pad(month)}-${pad(resolved)}`;
};

export const addDays = (date: string, days: number): string => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};

const anchorMonth = (period: Period, fye: string): number =>
  period.anchor === "fye" ? Number(fye.split("-")[0]) : period.anchor;

const dueDate = (due: Due, startIndex: number, endIndex: number): string => {
  const base = due.from === DueFrom.Start ? startIndex : endIndex;
  if ("days" in due) {
    const anchorDate = due.from === DueFrom.Start ? dateOf(startIndex, 1) : dateOf(endIndex, "last");
    return addDays(anchorDate, due.days);
  }
  return dateOf(base + due.months, due.day);
};

/**
 * Every occurrence of an entity's obligations whose due date falls in [from, to], sorted by due date.
 */
export const occurrences = (entity: Entity, from: string, to: string): Occurrence[] => {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const centre = monthIndex(fromYear, fromMonth);
  return entity.obligations
    .flatMap((obligation) => {
      const step = obligation.period.months;
      const anchor = anchorMonth(obligation.period, entity.fye);
      const first = centre - MONTHS_AROUND;
      const offset = (((monthIndex(fromYear, anchor) - first) % step) + step) % step;
      return Array.from({ length: Math.ceil((MONTHS_AROUND * 2) / step) }, (_, i) => first + offset + i * step).map(
        (endIndex): Occurrence => ({
          entity: entity.slug,
          entityName: entity.name,
          obligation: obligation.id,
          title: obligation.title,
          period: monthKey(endIndex),
          due: dueDate(obligation.due, endIndex - step + 1, endIndex),
          label: `obl:${entity.slug}:${obligation.id}:${monthKey(endIndex)}`,
          note: obligation.note,
          source: obligation.source,
        })
      );
    })
    .filter((occurrence) => {
      const obligation = entity.obligations.find((item) => item.id === occurrence.obligation);
      const afterStart = obligation?.from === undefined || occurrence.period >= obligation.from;
      const beforeEnd = obligation?.until === undefined || occurrence.period <= obligation.until;
      return afterStart && beforeEnd && occurrence.due >= from && occurrence.due <= to;
    })
    .sort((a, b) => a.due.localeCompare(b.due) || a.label.localeCompare(b.label));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isDue = (value: unknown): value is Due => {
  if (!isRecord(value) || (value.from !== DueFrom.Start && value.from !== DueFrom.End)) {
    return false;
  }
  if (typeof value.days === "number") {
    return true;
  }
  return typeof value.months === "number" && (value.day === "last" || typeof value.day === "number");
};

const isObligation = (value: unknown): value is Obligation =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.title === "string" &&
  isRecord(value.period) &&
  [1, 2, 3, 6, 12].includes(Number(value.period.months)) &&
  (value.period.anchor === "fye" || typeof value.period.anchor === "number") &&
  isDue(value.due);

/**
 * Parses one entity profile: flat facts in the frontmatter, obligations in the fenced yaml block
 * under `## Obligations` (a list of objects in frontmatter shows as raw JSON in Obsidian). Throws
 * with the file and obligation named, so a typo stops the run instead of dropping a deadline.
 */
export const parseEntity = (slug: string, raw: string): Entity => {
  const block = raw.match(FRONTMATTER_RE)?.[1];
  const data: unknown = block === undefined ? null : Bun.YAML.parse(block);
  if (!isRecord(data)) {
    throw new Error(`entities/${slug}.md has no frontmatter`);
  }
  if ("obligations" in data) {
    throw new Error(`entities/${slug}.md: move obligations out of the frontmatter into the yaml block under ## Obligations`);
  }
  const listed = raw.match(OBLIGATIONS_RE)?.[1];
  const parsed: unknown = listed === undefined ? [] : Bun.YAML.parse(listed);
  const obligations: unknown[] = Array.isArray(parsed) ? parsed : [];
  const invalid = obligations.find((item) => !isObligation(item));
  if (invalid !== undefined) {
    const id = isRecord(invalid) && typeof invalid.id === "string" ? invalid.id : JSON.stringify(invalid);
    throw new Error(`entities/${slug}.md: obligation ${id} is malformed (needs id, title, period, due)`);
  }
  return {
    slug,
    name: typeof data.name === "string" ? data.name : slug,
    kind: data.kind === EntityKind.Individual ? EntityKind.Individual : EntityKind.Company,
    country: typeof data.country === "string" ? data.country : "my",
    fye: typeof data.fye === "string" ? data.fye : "12-31",
    close: data.close === "monthly" ? "monthly" : "none",
    sme: data.sme === true,
    resident: typeof data.resident === "boolean" ? data.resident : null,
    spouseRelief: typeof data.spouse_relief === "boolean" ? data.spouse_relief : null,
    childrenUnder18: typeof data.children_under_18 === "number" ? data.children_under_18 : null,
    obligations: obligations.filter(isObligation),
  };
};

export const loadEntities = (taxDir: string): Entity[] => {
  const dir = join(taxDir, "entities");
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => parseEntity(basename(file, ".md"), readFileSync(join(dir, file), "utf8")));
};

/**
 * Tasks carrying an `obl:` label, from tasks/ and tasks/archive/ alike, so an obligation that was
 * done and archived, or cancelled on purpose, is never created again.
 */
export const loadExisting = (taxDir: string): ExistingTask[] =>
  [join(taxDir, "tasks"), join(taxDir, "tasks", "archive")]
    .filter((dir) => existsSync(dir))
    .flatMap((dir) =>
      readdirSync(dir)
        .filter((file) => file.endsWith(".md"))
        .map((file) => parseFrontmatter(readFileSync(join(dir, file), "utf8")))
    )
    .flatMap((frontmatter) =>
      frontmatter === null
        ? []
        : frontmatter.labels
            .filter((label) => label.startsWith("obl:"))
            .map((label): ExistingTask => ({ id: frontmatter.id, label, status: frontmatter.status }))
    );

/**
 * Open tax tasks with a due date that no obligation generated (a one-off filing, a request from
 * the accountant), so the dashboard shows everything with a date, not only the recurring rules.
 */
export const loadOneOffs = (taxDir: string, entities: Entity[]): Occurrence[] => {
  const dir = join(taxDir, "tasks");
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => parseFrontmatter(readFileSync(join(dir, file), "utf8")))
    .flatMap((frontmatter) => {
      if (
        frontmatter === null ||
        !frontmatter.due ||
        frontmatter.status === "done" ||
        frontmatter.status === "cancelled" ||
        frontmatter.labels.some((label) => label.startsWith("obl:"))
      ) {
        return [];
      }
      const slug = frontmatter.labels.find((label) => label.startsWith("entity:"))?.slice("entity:".length) ?? "";
      return [
        {
          entity: slug,
          entityName: entities.find((entity) => entity.slug === slug)?.name ?? "—",
          obligation: frontmatter.id,
          title: frontmatter.title,
          period: frontmatter.due.slice(0, 7),
          due: frontmatter.due,
          label: `task:${frontmatter.id}`,
        },
      ];
    });
};

const previousMonth = (today: string): string => {
  const [year, month] = today.split("-").map(Number);
  return monthKey(monthIndex(year, month) - 1);
};

export const pendingCloses = (taxDir: string, entities: Entity[], today: string): PendingClose[] => {
  const month = previousMonth(today);
  return entities
    .filter((entity) => entity.close === "monthly")
    .filter((entity) => !existsSync(join(taxDir, "closes", entity.slug, `${month}.md`)))
    .map((entity) => ({ entity: entity.slug, month }));
};

const leadOf = (entity: Entity, occurrence: Occurrence): number =>
  entity.obligations.find((item) => item.id === occurrence.obligation)?.lead ?? DEFAULT_LEAD_DAYS;

/**
 * Occurrences inside their lead window with no task yet. Overdue ones are included: a deadline
 * that slipped past unrecorded is exactly what must surface.
 */
export const plan = (taxDir: string, today: string): Plan => {
  const entities = loadEntities(taxDir);
  const existing = loadExisting(taxDir);
  const known = new Set(existing.map((task) => task.label));
  const missing = entities.flatMap((entity) =>
    occurrences(entity, addDays(today, -90), addDays(today, 366)).filter(
      (occurrence) => occurrence.due <= addDays(today, leadOf(entity, occurrence)) && !known.has(occurrence.label)
    )
  );
  return {
    today,
    missing: missing.sort((a, b) => a.due.localeCompare(b.due) || a.label.localeCompare(b.label)),
    existing,
    pendingCloses: pendingCloses(taxDir, entities, today),
  };
};

export const stateOf = (occurrence: Occurrence, existing: ExistingTask[], today: string): TaskState => {
  if (occurrence.label.startsWith("task:")) {
    return occurrence.due < today ? TaskState.Overdue : TaskState.Open;
  }
  const task = existing.find((item) => item.label === occurrence.label);
  if (task === undefined) {
    return occurrence.due < today ? TaskState.Overdue : TaskState.Upcoming;
  }
  if (task.status === "done") {
    return TaskState.Done;
  }
  if (task.status === "cancelled") {
    return TaskState.Skipped;
  }
  return occurrence.due < today ? TaskState.Overdue : TaskState.Open;
};

const argValue = (args: string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

if (import.meta.main) {
  const [command = "plan", ...rest] = process.argv.slice(2);
  const taxDir = argValue(rest, "--dir") ?? join(FOLDERS.PROJECTS, "tax");
  const today = argValue(rest, "--today") ?? todayDate();
  if (!existsSync(join(taxDir, "entities"))) {
    console.error(`no tax project at ${taxDir}: run the tax skill's setup playbook first`);
    process.exit(1);
  }
  if (command === "render") {
    const { renderDashboard } = await import("./dashboard");
    const path = join(taxDir, "dashboard.html");
    writeFileSync(path, renderDashboard(taxDir, today));
    console.log(path);
  } else if (command === "liability") {
    const { positions } = await import("./liability");
    const countriesDir = join(import.meta.dir, "..", "references", "countries");
    console.log(JSON.stringify(positions(taxDir, countriesDir, loadEntities(taxDir), today), null, 2));
  } else if (command === "plan") {
    console.log(JSON.stringify(plan(taxDir, today), null, 2));
  } else {
    console.error(`unknown command: ${command} (use plan, liability or render)`);
    process.exit(1);
  }
}
