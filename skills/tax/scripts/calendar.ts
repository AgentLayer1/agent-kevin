#!/usr/bin/env bun
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { FOLDERS } from "../../../mcp-server/src/config";
import { todayDate } from "../../../mcp-server/src/shared/date";
import { parseFrontmatter } from "../../../mcp-server/src/tasks/schema";

/**
 * Deadline engine for the tax skill. Reads entity profiles from <projects>/tax/entities/*.md,
 * expands each obligation into dated occurrences, matches them against existing tasks by their
 * `obl:` label, and renders <projects>/tax/dashboard.html. Never creates tasks itself.
 *
 * Usage: bun calendar.ts plan [--today YYYY-MM-DD]    prints { missing, existing, pendingCloses }
 *        bun calendar.ts render [--today YYYY-MM-DD]  writes dashboard.html, prints its path
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

export interface Entity {
  slug: string;
  name: string;
  fye: string;
  close: "monthly" | "none";
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
    fye: typeof data.fye === "string" ? data.fye : "12-31",
    close: data.close === "monthly" ? "monthly" : "none",
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

interface EstimateRecord {
  entity: string;
  ya: string;
  filed: number;
  projected: number;
  exposure: number;
  updated: string;
}

/**
 * The newest estimate record per entity: estimates/<entity>/<YA>.md frontmatter, written by the
 * estimate playbook.
 */
export const loadEstimates = (taxDir: string, entities: Entity[]): EstimateRecord[] =>
  entities.flatMap((entity) => {
    const dir = join(taxDir, "estimates", entity.slug);
    if (!existsSync(dir)) {
      return [];
    }
    const latest = readdirSync(dir)
      .filter((file) => file.endsWith(".md"))
      .sort()
      .at(-1);
    if (latest === undefined) {
      return [];
    }
    const block = readFileSync(join(dir, latest), "utf8").match(FRONTMATTER_RE)?.[1];
    const data: unknown = block === undefined ? null : Bun.YAML.parse(block);
    if (!isRecord(data)) {
      return [];
    }
    return [
      {
        entity: entity.name,
        ya: String(data.ya ?? basename(latest, ".md")),
        filed: Number(data.filed ?? 0),
        projected: Number(data.projected ?? 0),
        exposure: Number(data.exposure ?? 0),
        updated: String(data.updated ?? ""),
      },
    ];
  });

const lastClosed = (taxDir: string, entity: Entity): string | null => {
  const dir = join(taxDir, "closes", entity.slug);
  if (!existsSync(dir)) {
    return null;
  }
  return (
    readdirSync(dir)
      .filter((file) => /^\d{4}-\d{2}\.md$/.test(file))
      .sort()
      .map((file) => basename(file, ".md"))
      .at(-1) ?? null
  );
};

const escapeHtml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const ringgit = (amount: number): string =>
  `RM${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const monthLabel = (key: string): string => {
  const [year, month] = key.split("-").map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
};

const chip = (occurrence: Occurrence, state: TaskState): string =>
  `<li class="chip ${state}" title="${escapeHtml(occurrence.note ?? occurrence.title)}"><span class="day">${Number(
    occurrence.due.slice(8)
  )}</span> ${escapeHtml(occurrence.title)}</li>`;

/**
 * The whole dashboard page. Pure: the same inputs and `today` give byte-identical output, so the
 * file only changes when an obligation, task, close or estimate does.
 */
export const renderDashboard = (taxDir: string, today: string): string => {
  const entities = loadEntities(taxDir);
  const existing = loadExisting(taxDir);
  const [year, month] = today.split("-").map(Number);
  const months = Array.from({ length: 12 }, (_, i) => monthKey(monthIndex(year, month) + i));
  const windowEnd = dateOf(monthIndex(year, month) + 11, "last");
  const oneOffs = loadOneOffs(taxDir, entities);
  const all = [
    ...entities.flatMap((entity) => occurrences(entity, `${months[0]}-01`, windowEnd)),
    ...oneOffs.filter((item) => item.due >= `${months[0]}-01` && item.due <= windowEnd),
  ].sort((a, b) => a.due.localeCompare(b.due) || a.label.localeCompare(b.label));
  const overdue = [
    ...entities.flatMap((entity) => occurrences(entity, addDays(today, -366), addDays(today, -1))),
    ...oneOffs.filter((item) => item.due < today),
  ].filter((occurrence) => stateOf(occurrence, existing, today) === TaskState.Overdue);
  const soon = [...overdue, ...all.filter((occurrence) => occurrence.due >= today && occurrence.due <= addDays(today, 30))];

  const grid = entities
    .map(
      (entity) =>
        `<tr><th scope="row">${escapeHtml(entity.name)}</th>${months
          .map((key) => {
            const cell = all.filter((item) => item.entity === entity.slug && item.due.startsWith(key));
            return `<td>${cell.length === 0 ? "" : `<ul>${cell.map((item) => chip(item, stateOf(item, existing, today))).join("")}</ul>`}</td>`;
          })
          .join("")}</tr>`
    )
    .join("\n");

  const soonRows =
    soon.length === 0
      ? `<p class="empty">Nothing due in the next 30 days.</p>`
      : `<table class="list"><thead><tr><th>Due</th><th>Entity</th><th>What</th><th>State</th></tr></thead><tbody>${soon
          .map((item) => {
            const state = stateOf(item, existing, today);
            return `<tr><td>${item.due}</td><td>${escapeHtml(item.entityName)}</td><td>${escapeHtml(item.title)}</td><td><span class="tag ${state}">${state}</span></td></tr>`;
          })
          .join("")}</tbody></table>`;

  const estimates = loadEstimates(taxDir, entities);
  const estimateSection =
    estimates.length === 0
      ? ""
      : `<section><h2>Tax estimates</h2><table class="list"><thead><tr><th>Entity</th><th>YA</th><th>On file</th><th>Projected</th><th>Penalty exposure</th><th>Updated</th></tr></thead><tbody>${estimates
          .map(
            (item) =>
              `<tr><td>${escapeHtml(item.entity)}</td><td>${escapeHtml(item.ya)}</td><td>${ringgit(item.filed)}</td><td>${ringgit(item.projected)}</td><td class="${item.exposure > 0 ? "warn" : ""}">${ringgit(item.exposure)}</td><td>${escapeHtml(item.updated)}</td></tr>`
          )
          .join("")}</tbody></table></section>`;

  const closeRows = entities
    .filter((entity) => entity.close === "monthly")
    .map((entity) => {
      const closed = lastClosed(taxDir, entity);
      const due = previousMonth(today);
      const current = closed !== null && closed >= due;
      return `<tr><td>${escapeHtml(entity.name)}</td><td>${closed === null ? "never" : monthLabel(closed)}</td><td><span class="tag ${current ? "done" : "overdue"}">${current ? "current" : `${monthLabel(due)} open`}</span></td></tr>`;
    })
    .join("");
  const closeSection =
    closeRows === ""
      ? ""
      : `<section><h2>Monthly close</h2><table class="list"><thead><tr><th>Entity</th><th>Last closed</th><th>Status</th></tr></thead><tbody>${closeRows}</tbody></table></section>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tax &amp; Books</title>
<style>
:root { color-scheme: light dark; --bg: #fbfaf7; --fg: #1d1d1f; --muted: #6e6e73; --line: #e3e1dc; --card: #ffffff;
  --done: #2f7d4f; --open: #2b62c2; --overdue: #c2412b; --upcoming: #8a8a8e; --skipped: #a0a0a4; }
@media (prefers-color-scheme: dark) { :root { --bg: #151517; --fg: #ececee; --muted: #9a9aa0; --line: #2c2c30; --card: #1d1d20;
  --done: #5cc38a; --open: #7aa7ff; --overdue: #ff7a63; --upcoming: #8e8e94; --skipped: #6a6a70; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 32px; background: var(--bg); color: var(--fg); font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 28px 0 10px; }
.sub { color: var(--muted); margin: 0 0 20px; }
section { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; margin-bottom: 18px; overflow-x: auto; }
section h2 { margin-top: 0; }
table { border-collapse: collapse; width: 100%; }
.grid th, .grid td { border: 1px solid var(--line); vertical-align: top; padding: 5px; min-width: 84px; }
.grid thead th { font-weight: 600; color: var(--muted); text-align: left; }
.grid tbody th { text-align: left; white-space: nowrap; }
.grid ul { list-style: none; margin: 0; padding: 0; }
.chip { font-size: 11.5px; margin: 0 0 4px; padding: 2px 6px; border-left: 3px solid var(--upcoming); border-radius: 4px; background: color-mix(in srgb, var(--upcoming) 10%, transparent); }
.chip .day { font-weight: 600; }
.chip.done { border-color: var(--done); background: color-mix(in srgb, var(--done) 12%, transparent); text-decoration: line-through; }
.chip.open { border-color: var(--open); background: color-mix(in srgb, var(--open) 12%, transparent); }
.chip.overdue { border-color: var(--overdue); background: color-mix(in srgb, var(--overdue) 14%, transparent); }
.chip.skipped { border-color: var(--skipped); opacity: 0.6; }
.list th, .list td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); }
.list thead th { color: var(--muted); font-weight: 600; }
.tag { font-size: 12px; padding: 1px 8px; border-radius: 999px; border: 1px solid currentColor; }
.tag.done { color: var(--done); } .tag.open { color: var(--open); } .tag.overdue { color: var(--overdue); }
.tag.upcoming { color: var(--upcoming); } .tag.skipped { color: var(--skipped); }
.warn { color: var(--overdue); font-weight: 600; }
.empty { color: var(--muted); margin: 0; }
.legend { color: var(--muted); font-size: 12px; margin-top: 8px; }
</style>
</head>
<body>
<h1>Tax &amp; Books</h1>
<p class="sub">As of ${today} · generated by the tax skill, don't edit by hand</p>
<section><h2>Next 30 days</h2>${soonRows}</section>
<section><h2>Calendar</h2><table class="grid"><thead><tr><th></th>${months
    .map((key) => `<th>${monthLabel(key)}</th>`)
    .join("")}</tr></thead><tbody>
${grid}
</tbody></table><p class="legend">Blue: task open · green: done · red: overdue · grey: not yet a task (created ${DEFAULT_LEAD_DAYS} days ahead by default)</p></section>
${estimateSection}
${closeSection}
</body>
</html>
`;
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
    mkdirSync(taxDir, { recursive: true });
    const path = join(taxDir, "dashboard.html");
    writeFileSync(path, renderDashboard(taxDir, today));
    console.log(path);
  } else if (command === "plan") {
    console.log(JSON.stringify(plan(taxDir, today), null, 2));
  } else {
    console.error(`unknown command: ${command} (use plan or render)`);
    process.exit(1);
  }
}
