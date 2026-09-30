#!/usr/bin/env bun
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FOLDERS } from "../../../mcp-server/src/config";
import { todayDate } from "../../../mcp-server/src/shared/date";
import { agentKeyName, runtimeDirName } from "../../../mcp-server/src/shared/naming";
import { agentHomePath, isAgentHome } from "../../../mcp-server/src/shared/env";
import { RETIRED_CADENCE_KEYS } from "../../../mcp-server/src/shared/retired-skills";
import { loadEntities, pendingCloses } from "../../tax/scripts/calendar";

/**
 * Read-only cadence detector for sync and a bare `/goals`. Prints a JSON array of
 * the planning / review cadences that are due, each with the command that runs it.
 * Never mutates.
 *
 * Usage: bun cadence.ts
 */

const home = agentHomePath();
if (!isAgentHome(home)) {
  console.error(`not an agent home: ${home} — set ${agentKeyName("HOME")}`);
  process.exit(1);
}

const readJson = <T>(path: string): T | null => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
};

const dataDir = join(home, runtimeDirName());
const stamps = readJson<Record<string, string>>(join(dataDir, "cadence.json")) ?? {};
// A home that hasn't run the 0.6.1 upgrade still holds the old keys; the later stamp wins either way.
const cadence = Object.entries(RETIRED_CADENCE_KEYS).reduce<Record<string, string>>((acc, [old, key]) => {
  const latest = [acc[key], stamps[old]].filter((value): value is string => typeof value === "string").sort().at(-1);
  return latest ? { ...acc, [key]: latest } : acc;
}, stamps);
const selfReview = readJson<{ lastRun?: string }>(join(dataDir, "review.json")) ?? {};

const now = new Date();
const parseDate = (value: string | undefined): Date | null =>
  value ? new Date(`${value}T00:00:00`) : null;

const calendarMonth = (date: Date): string => `${date.getFullYear()}-${date.getMonth() + 1}`;

const isoWeek = (date: Date): string => {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${week}`;
};

const quarter = (date: Date): string => `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`;

interface Due {
  invoke: string;
  label: string;
  lastRun: string | null;
}

const bucketChanged = (last: Date | null, bucket: (date: Date) => string): boolean =>
  last === null || bucket(last) !== bucket(now);

const due: Due[] = [];

const goals = [
  { key: "goals-week", invoke: "goals week interview", label: "Weekly goals", bucket: isoWeek },
  { key: "goals-month", invoke: "goals month", label: "Monthly goals", bucket: calendarMonth },
  { key: "goals-year", invoke: "goals year", label: "Yearly goals (quarter)", bucket: quarter },
] as const;

due.push(
  ...goals
    .filter((goal) => bucketChanged(parseDate(cadence[goal.key]), goal.bucket))
    .map((goal) => ({ invoke: goal.invoke, label: goal.label, lastRun: cadence[goal.key] ?? null })),
);

const feedbackMtime = ((): Date | null => {
  try {
    return statSync(join(home, "knowledge/raw/user/feedback.md")).mtime;
  } catch {
    return null;
  }
})();
const lastReview = parseDate(selfReview.lastRun);
const reviewAgeDays = lastReview === null ? Infinity : (now.getTime() - lastReview.getTime()) / 86_400_000;
const hasNewFeedback = feedbackMtime !== null && (lastReview === null || feedbackMtime > lastReview);
// Context decays without new feedback, so a home that has run the pass before is nudged on the
// calendar too; a home that never ran it still waits for feedback, so a fresh init stays quiet.
if ((reviewAgeDays >= 14 && hasNewFeedback) || (lastReview !== null && reviewAgeDays >= 30)) {
  due.push({ invoke: "self-review", label: "Self-review", lastRun: selfReview.lastRun ?? null });
}

// The close records are the watermark: an entity is due when last month's record is missing. A
// profile the tax engine refuses surfaces as its own item rather than dropping every other nudge.
const taxDir = join(FOLDERS.PROJECTS, "tax");
if (existsSync(join(taxDir, "entities"))) {
  try {
    const closes = pendingCloses(taxDir, loadEntities(taxDir), todayDate());
    if (closes.length > 0) {
      const entities = closes.map((close) => close.entity).join(", ");
      due.push({ invoke: "tax close", label: `Tax close for ${closes[0].month} (${entities})`, lastRun: null });
    }
  } catch (error) {
    due.push({ invoke: "tax", label: `Fix the tax profile: ${error instanceof Error ? error.message : String(error)}`, lastRun: null });
  }
}

console.log(JSON.stringify(due));
