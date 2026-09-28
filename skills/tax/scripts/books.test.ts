import { describe, expect, test } from "bun:test";
import { type Ask, booksFor, type CloseRecord, MonthState, monthRange, parseClose } from "./books";
import type { Entity } from "./calendar";
import type { LedgerRow } from "./liability";

const acme: Entity = {
  slug: "acme",
  name: "Acme Sdn. Bhd.",
  kind: "company",
  country: "my",
  fye: "12-31",
  close: "monthly",
  sme: false,
  resident: null,
  spouseRelief: null,
  childrenUnder18: null,
  startedOn: "2025-03-10",
  bookedThrough: "2026-03",
  accounts: [
    { id: "main", name: "Main current account" },
    { id: "usd", name: "USD account" },
  ],
  obligations: [],
};

const row = (date: string, type: string, category = ""): LedgerRow => ({
  date,
  type,
  counterparty: "x",
  currency: "MYR",
  amount: 100,
  amountMyr: null,
  tax: 0,
  reference: "",
  category,
  flags: [],
});

const close = (month: string, extra: Partial<CloseRecord> = {}): CloseRecord => ({ month, status: "closed", sent: null, gaps: [], ...extra });

const window = monthRange("2026-01", "2026-09");
const stateOf = (books: ReturnType<typeof booksFor>, month: string) => books?.months.find((item) => item.month === month)?.state;

describe("booksFor: month states", () => {
  test("each state at its boundary, first matching rule wins", () => {
    const rows = [row("2026-07-10", "receipt"), row("2026-06-30", "statement", "main")];
    const closes = [
      close("2026-04", { sent: "2026-05-05", status: "partial", gaps: [] }),
      close("2026-05", { status: "partial" }),
      close("2026-06"),
    ];
    const books = booksFor(acme, rows, closes, [], "2026-09-28", window);
    expect(stateOf(books, "2026-03")).toBe(MonthState.Booked);
    expect(stateOf(books, "2026-04")).toBe(MonthState.Sent);
    expect(stateOf(books, "2026-05")).toBe(MonthState.Gaps);
    expect(stateOf(books, "2026-06")).toBe(MonthState.Ready);
    expect(stateOf(books, "2026-07")).toBe(MonthState.Collecting);
    expect(stateOf(books, "2026-08")).toBe(MonthState.Todo);
    expect(stateOf(books, "2026-09")).toBe(MonthState.Open);
  });

  test("booked by the accountant wins over a sent close for the same month", () => {
    const books = booksFor(acme, [], [close("2026-03", { sent: "2026-04-02" })], [], "2026-09-28", window);
    expect(stateOf(books, "2026-03")).toBe(MonthState.Booked);
  });

  test("months before the company started are before, not to do", () => {
    const books = booksFor({ ...acme, startedOn: "2026-05-12", bookedThrough: null }, [], [], [], "2026-09-28", window);
    expect(stateOf(books, "2026-04")).toBe(MonthState.Before);
    expect(stateOf(books, "2026-05")).toBe(MonthState.Todo);
    expect(books?.behind).toBe(4);
  });

  test("a closed record with open gaps still needs tending", () => {
    const gap = { date: "2026-05-03", account: "main", amount: 450, currency: "MYR", direction: "out" as const, need: "receipt" as const, note: "" };
    const books = booksFor(acme, [], [close("2026-05", { gaps: [gap] })], [], "2026-09-28", window);
    expect(stateOf(books, "2026-05")).toBe(MonthState.Gaps);
  });

  test("an individual has no books", () => {
    expect(booksFor({ ...acme, kind: "individual" }, [], [], [], "2026-09-28", window)).toBeNull();
  });
});

describe("booksFor: what to collect", () => {
  test("missing statements fold into one run per account, a month that has one splits the run, oldest run first", () => {
    const books = booksFor(acme, [row("2026-06-30", "statement", "main")], [], [], "2026-09-28", window);
    const runs = books?.toCollect.filter((item) => item.kind === "statements") ?? [];
    expect(runs).toEqual([
      { kind: "statements", account: "main", name: "Main current account", months: ["2026-04", "2026-05"] },
      { kind: "statements", account: "usd", name: "USD account", months: ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"] },
      { kind: "statements", account: "main", name: "Main current account", months: ["2026-07", "2026-08"] },
    ]);
  });

  test("sent, ready and booked months ask for nothing, and the current month is not yet due", () => {
    const books = booksFor(acme, [], [close("2026-04", { sent: "2026-05-02" }), close("2026-05")], [], "2026-09-28", window);
    const months = (books?.toCollect ?? []).flatMap((item) => (item.kind === "statements" ? item.months : []));
    expect(months).not.toContain("2026-03");
    expect(months).not.toContain("2026-04");
    expect(months).not.toContain("2026-05");
    expect(months).not.toContain("2026-09");
  });

  test("open gaps are listed oldest first; a booked month's gaps are not", () => {
    const gap = (date: string) => ({ date, account: "main", amount: 10, currency: "MYR", direction: "out" as const, need: "explanation" as const, note: "" });
    const closes = [close("2026-03", { gaps: [gap("2026-03-02")] }), close("2026-06", { gaps: [gap("2026-06-20"), gap("2026-06-02")] })];
    const books = booksFor(acme, [], closes, [], "2026-09-28", window);
    const dates = (books?.toCollect ?? []).flatMap((item) => (item.kind === "gap" ? [item.gap.date] : []));
    expect(dates).toEqual(["2026-06-02", "2026-06-20"]);
  });

  test("the accountant's open asks are included as given", () => {
    const asks: Ask[] = [{ id: "ta-001", title: "Catch-up", due: "2026-10-31" }];
    const books = booksFor(acme, [], [], asks, "2026-09-28", window);
    expect(books?.toCollect.filter((item) => item.kind === "ask")).toEqual([{ kind: "ask", ask: asks[0] }]);
  });

  test("a company with no accounts or booked month asks for them instead of counting zero statements", () => {
    const books = booksFor({ ...acme, accounts: [], bookedThrough: null }, [], [], [], "2026-09-28", window);
    const texts = (books?.toCollect ?? []).flatMap((item) => (item.kind === "profile" ? [item.text] : []));
    expect(texts).toHaveLength(2);
    expect(books?.toCollect.some((item) => item.kind === "statements")).toBe(false);
    expect(books?.months.every((item) => item.statementsMissing.length === 0)).toBe(true);
  });

  test("behind counts every unbooked ended month; needs-you leaves out what is with the accountant", () => {
    const books = booksFor(acme, [], [close("2026-04", { sent: "2026-05-02" })], [], "2026-09-28", window);
    expect(books?.behind).toBe(5);
    expect(books?.needsYou).toBe(4);
  });
});

describe("parseClose", () => {
  test("reads the flat frontmatter and the gaps block", () => {
    const raw = `---\nmonth: "2026-10"\nstatus: partial\ngaps: 1\nsent: null\n---\n\n## Gaps\n\n\`\`\`yaml\n- { date: "2026-10-03", account: main, amount: 450.5, direction: out, need: receipt, note: Transfer }\n\`\`\`\n`;
    const record = parseClose("closes/acme/2026-10.md", raw);
    expect(record.status).toBe("partial");
    expect(record.gaps[0]).toEqual({ date: "2026-10-03", account: "main", amount: 450.5, currency: "MYR", direction: "out", need: "receipt", note: "Transfer" });
  });

  test("a malformed gap stops the run with the file named", () => {
    const raw = "---\nstatus: partial\n---\n\n## Gaps\n\n```yaml\n- { date: \"2026-10-03\", amount: 1, direction: sideways, need: receipt }\n```\n";
    expect(() => parseClose("closes/acme/2026-10.md", raw)).toThrow("closes/acme/2026-10.md");
  });
});
