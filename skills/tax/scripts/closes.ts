import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { frontmatterOf, listBlock } from "./calendar";

/**
 * Monthly close records at closes/<slug>/<YYYY-MM>.md: flat frontmatter plus the open gaps in a
 * yaml block. Shared by the books view and the tax position, which both need a close's status.
 */

export const GapNeed = { Receipt: "receipt", Invoice: "invoice", Explanation: "explanation" } as const;
export type GapNeed = (typeof GapNeed)[keyof typeof GapNeed];

export interface Gap {
  date: string;
  account: string;
  amount: number;
  currency: string;
  direction: "in" | "out";
  need: GapNeed;
  note: string;
}

export interface CloseRecord {
  month: string;
  status: "closed" | "partial";
  sent: string | null;
  gaps: Gap[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isGap = (value: unknown): value is Gap =>
  isRecord(value) &&
  typeof value.date === "string" &&
  typeof value.amount === "number" &&
  (value.direction === "in" || value.direction === "out") &&
  Object.values(GapNeed).includes(value.need as GapNeed);

/**
 * One close record: flat frontmatter plus the open gaps in the yaml block under `## Gaps`. A
 * malformed gap throws with the file named, so an unexplained payment is never silently dropped.
 */
export const parseClose = (file: string, raw: string): CloseRecord => {
  const data = frontmatterOf(raw) ?? {};
  const gaps = listBlock(file, raw, "Gaps");
  if (gaps.some((gap) => !isGap(gap))) {
    throw new Error(`${file}: every gap needs date, amount, direction (in or out) and need (receipt, invoice or explanation)`);
  }
  return {
    month: typeof data.month === "string" ? data.month : basename(file, ".md"),
    status: data.status === "closed" ? "closed" : "partial",
    sent: typeof data.sent === "string" ? data.sent : null,
    gaps: gaps.filter(isGap).map((gap) => ({
      ...gap,
      account: typeof gap.account === "string" ? gap.account : "",
      currency: typeof gap.currency === "string" ? gap.currency : "MYR",
      note: typeof gap.note === "string" ? gap.note : "",
    })),
  };
};

export const loadCloses = (taxDir: string, slug: string): CloseRecord[] => {
  const dir = join(taxDir, "closes", slug);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((file) => /^\d{4}-\d{2}\.md$/.test(file))
    .sort()
    .map((file) => parseClose(join("closes", slug, file), readFileSync(join(dir, file), "utf8")));
};
