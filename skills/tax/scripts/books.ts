import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../../../mcp-server/src/tasks/schema";
import { type Entity, EntityKind } from "./calendar";
import { type CloseRecord, type Gap, loadCloses } from "./closes";
import { type LedgerRow, LedgerType, loadLedger } from "./liability";

/**
 * Bookkeeping state per company and month: what the accountant has booked, what is with them,
 * and what the operator still has to collect. Derived only from the profile, the ledger, the
 * close records and the tax tasks; nothing here is stored.
 */

export const MonthState = {
  Before: "before",
  Booked: "booked",
  Sent: "sent",
  Ready: "ready",
  Gaps: "gaps",
  Collecting: "collecting",
  Todo: "todo",
  Open: "open",
  Future: "future",
} as const;
export type MonthState = (typeof MonthState)[keyof typeof MonthState];

export interface Ask {
  id: string;
  title: string;
  due: string | null;
}

export interface MonthBooks {
  month: string;
  state: MonthState;
  statementsIn: string[];
  statementsMissing: string[];
  documents: number;
  gaps: number;
  sent: string | null;
}

export type CollectItem =
  | { kind: "profile"; text: string }
  | { kind: "statements"; account: string; name: string; months: string[] }
  | { kind: "gap"; month: string; gap: Gap }
  | { kind: "ask"; ask: Ask };

export interface Books {
  entity: string;
  bookedThrough: string | null;
  months: MonthBooks[];
  toCollect: CollectItem[];
  behind: number;
  needsYou: number;
}

const ACCOUNTANT_LABELS = new Set(["accountant", "bookkeeping"]);
const SETTLED = new Set<MonthState>([MonthState.Booked, MonthState.Sent, MonthState.Ready]);
const NEEDS_YOU = new Set<MonthState>([MonthState.Todo, MonthState.Collecting, MonthState.Gaps, MonthState.Ready]);

const monthIndex = (month: string): number => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
const monthOf = (index: number): string => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;

export const monthRange = (from: string, to: string): string[] =>
  monthIndex(to) < monthIndex(from)
    ? []
    : Array.from({ length: monthIndex(to) - monthIndex(from) + 1 }, (_, i) => monthOf(monthIndex(from) + i));

export const shiftMonth = (month: string, by: number): string => monthOf(monthIndex(month) + by);

/**
 * Open tax tasks the accountant is waiting on: labelled `accountant` or `bookkeeping` and
 * `entity:<slug>`.
 */
export const loadAsks = (taxDir: string, slug: string): Ask[] => {
  const dir = join(taxDir, "tasks");
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => parseFrontmatter(readFileSync(join(dir, file), "utf8")))
    .filter((task) => task !== null)
    .filter(
      (task) =>
        task.status !== "done" &&
        task.status !== "cancelled" &&
        task.labels.includes(`entity:${slug}`) &&
        task.labels.some((label) => ACCOUNTANT_LABELS.has(label))
    )
    .map((task) => ({ id: task.id, title: task.title, due: task.due || null }))
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.id.localeCompare(b.id));
};

const stateOfMonth = (
  month: string,
  entity: Entity,
  close: CloseRecord | undefined,
  recorded: number,
  current: string
): MonthState => {
  if (month > current) {
    return MonthState.Future;
  }
  if (entity.startedOn !== null && month < entity.startedOn.slice(0, 7)) {
    return MonthState.Before;
  }
  if (entity.bookedThrough !== null && month <= entity.bookedThrough) {
    return MonthState.Booked;
  }
  if (close?.sent) {
    return MonthState.Sent;
  }
  if (close !== undefined && (close.status === "partial" || close.gaps.length > 0)) {
    return MonthState.Gaps;
  }
  if (close !== undefined) {
    return MonthState.Ready;
  }
  if (month === current) {
    return MonthState.Open;
  }
  return recorded > 0 ? MonthState.Collecting : MonthState.Todo;
};

/**
 * Consecutive months per account folded into one item, so six missing statements read as one
 * line, and a month that has its statement splits the run. Oldest run first.
 */
const statementRuns = (entity: Entity, months: MonthBooks[]): CollectItem[] =>
  entity.accounts.flatMap((account) =>
    months
      .filter((item) => item.statementsMissing.includes(account.id))
      .map((item) => item.month)
      .reduce<string[][]>((runs, month) => {
        const last = runs.at(-1);
        return last !== undefined && shiftMonth(last.at(-1) ?? month, 1) === month
          ? [...runs.slice(0, -1), [...last, month]]
          : [...runs, [month]];
      }, [])
      .map((run) => ({ kind: "statements" as const, account: account.id, name: account.name, months: run }))
  )
  .sort((a, b) => a.months[0].localeCompare(b.months[0]));

/**
 * The bookkeeping state of one company as of `today`, over `window` (months to render) and the
 * backlog since the accountant's last booked month.
 */
export const booksFor = (
  entity: Entity,
  rows: LedgerRow[],
  closes: CloseRecord[],
  asks: Ask[],
  today: string,
  window: string[]
): Books | null => {
  if (entity.kind !== EntityKind.Company) {
    return null;
  }
  const current = today.slice(0, 7);
  const lastEnded = shiftMonth(current, -1);
  const starts = [
    entity.bookedThrough === null ? null : shiftMonth(entity.bookedThrough, 1),
    entity.startedOn?.slice(0, 7) ?? null,
  ].filter((month): month is string => month !== null);
  const backlogStart = starts.length > 0 ? starts.sort().at(-1) ?? window[0] : window[0];
  const describe = (month: string): MonthBooks => {
    const inMonth = rows.filter((row) => row.date.startsWith(month));
    const statementsIn = entity.accounts
      .map((account) => account.id)
      .filter((id) => inMonth.some((row) => row.type === LedgerType.Statement && row.category === id));
    const documents = inMonth.filter((row) => row.type !== LedgerType.Statement).length;
    const close = closes.find((record) => record.month === month);
    const state = stateOfMonth(month, entity, close, documents + statementsIn.length, current);
    const collectable = !SETTLED.has(state) && state !== MonthState.Before && month <= lastEnded;
    return {
      month,
      state,
      statementsIn,
      statementsMissing: collectable ? entity.accounts.map((account) => account.id).filter((id) => !statementsIn.includes(id)) : [],
      documents,
      gaps: close?.gaps.length ?? 0,
      sent: close?.sent ?? null,
    };
  };
  const backlog = monthRange(backlogStart, lastEnded).map(describe);
  const openGaps = closes
    .filter((record) => backlog.some((item) => item.month === record.month && item.state !== MonthState.Booked))
    .flatMap((record) => record.gaps.map((gap) => ({ month: record.month, gap })))
    .sort((a, b) => a.gap.date.localeCompare(b.gap.date))
    .map(({ month, gap }): CollectItem => ({ kind: "gap", month, gap }));
  const profile: CollectItem[] = [
    ...(entity.accounts.length === 0 ? [{ kind: "profile" as const, text: "List the company's bank accounts in its profile" }] : []),
    ...(entity.bookedThrough === null
      ? [{ kind: "profile" as const, text: "Ask your accountant which month the books are current through" }]
      : []),
  ];
  return {
    entity: entity.slug,
    bookedThrough: entity.bookedThrough,
    months: window.map(describe),
    toCollect: [...profile, ...statementRuns(entity, backlog), ...openGaps, ...asks.map((ask): CollectItem => ({ kind: "ask", ask }))],
    behind: backlog.filter((item) => item.state !== MonthState.Booked && item.state !== MonthState.Before).length,
    needsYou: backlog.filter((item) => NEEDS_YOU.has(item.state)).length,
  };
};

export const trailingMonths = (today: string, count = 12): string[] => monthRange(shiftMonth(today.slice(0, 7), 1 - count), today.slice(0, 7));

export const booksAll = (taxDir: string, entities: Entity[], today: string): Books[] =>
  entities
    .map((entity) =>
      booksFor(entity, loadLedger(taxDir, entity.slug), loadCloses(taxDir, entity.slug), loadAsks(taxDir, entity.slug), today, trailingMonths(today))
    )
    .filter((books): books is Books => books !== null);
