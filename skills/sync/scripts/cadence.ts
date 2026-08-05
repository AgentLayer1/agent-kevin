#!/usr/bin/env bun
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { agentKeyName, runtimeDirName } from "../../../mcp-server/src/shared/naming";
import { agentHomePath, isAgentHome } from "../../../mcp-server/src/shared/env";

/**
 * Read-only cadence detector for sync. Prints a JSON array of the planning /
 * review skills that are due, based on per-skill watermarks. Never mutates.
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
const cadence = readJson<Record<string, string>>(join(dataDir, "cadence.json")) ?? {};
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
  skill: string;
  label: string;
  lastRun: string | null;
}

const bucketChanged = (last: Date | null, bucket: (date: Date) => string): boolean =>
  last === null || bucket(last) !== bucket(now);

const due: Due[] = [];

if (bucketChanged(parseDate(cadence["weekly-goals"]), isoWeek)) {
  due.push({ skill: "weekly-goals", label: "Weekly goals", lastRun: cadence["weekly-goals"] ?? null });
}

if (bucketChanged(parseDate(cadence["monthly-goals"]), calendarMonth)) {
  due.push({ skill: "monthly-goals", label: "Monthly goals", lastRun: cadence["monthly-goals"] ?? null });
}

if (bucketChanged(parseDate(cadence["yearly-goals"]), quarter)) {
  due.push({ skill: "yearly-goals", label: "Yearly goals (quarter)", lastRun: cadence["yearly-goals"] ?? null });
}

const feedbackMtime = ((): Date | null => {
  try {
    return statSync(join(home, "knowledge/raw/user/feedback.md")).mtime;
  } catch {
    return null;
  }
})();
const lastReview = parseDate(selfReview.lastRun);
const reviewStale = lastReview === null || (now.getTime() - lastReview.getTime()) / 86_400_000 >= 14;
const hasNewFeedback = feedbackMtime !== null && (lastReview === null || feedbackMtime > lastReview);
if (reviewStale && hasNewFeedback) {
  due.push({ skill: "self-review", label: "Self-review", lastRun: selfReview.lastRun ?? null });
}

console.log(JSON.stringify(due));
