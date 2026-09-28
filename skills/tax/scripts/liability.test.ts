import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Entity } from "./calendar";
import { bandTax, type LedgerRow, parseCsv, parseRates, periodFor, position, toLedgerRow } from "./liability";

const rates = parseRates(readFileSync(join(import.meta.dir, "..", "references", "countries", "my.md"), "utf8"));

const company: Entity = {
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
  startedOn: null,
  bookedThrough: null,
  accounts: [],
  obligations: [],
};

const person: Entity = { ...company, slug: "ada", name: "Ada", kind: "individual", resident: true, close: "none" };

const row = (date: string, type: string, amount: number, extra: Partial<LedgerRow> = {}): LedgerRow => ({
  date,
  type,
  counterparty: "x",
  currency: "MYR",
  amount,
  amountMyr: null,
  tax: 0,
  reference: "",
  category: "",
  flags: [],
  ...extra,
});

describe("rates", () => {
  test("every country reference ships a Rates block the engine parses", () => {
    expect(rates.company.flat).toBe(24);
    expect(rates.individual.reliefs.find((relief) => relief.id === "self")?.cap).toBe(9000);
  });

  test("resident bands match the published cumulative schedule at every boundary", () => {
    const schedule: Array<[number, number]> = [
      [5000, 0],
      [20000, 150],
      [35000, 600],
      [50000, 1500],
      [70000, 3700],
      [100000, 9400],
      [400000, 84400],
      [600000, 136400],
      [2000000, 528400],
    ];
    schedule.forEach(([income, tax]) => expect(bandTax(income, rates.individual.resident)).toBeCloseTo(tax, 2));
  });

  test("SME tiers tax the first RM150k at 15% and the next slice at 17%", () => {
    expect(bandTax(200000, rates.company.sme)).toBeCloseTo(150000 * 0.15 + 50000 * 0.17, 2);
  });
});

describe("periodFor", () => {
  test("a December year end gives the calendar year, and the YA is the year it ends in", () => {
    expect(periodFor("12-31", "2026-09-28")).toEqual({ start: "2026-01-01", end: "2026-12-31", ya: 2026 });
  });
  test("a March year end straddles two calendar years", () => {
    expect(periodFor("03-31", "2026-09-28")).toEqual({ start: "2026-04-01", end: "2027-03-31", ya: 2027 });
  });
});

describe("position: company", () => {
  test("a foreign-owned company pays the flat rate on profit so far, even when small", () => {
    const result = position(company, [row("2026-02-10", "sales-invoice", 100000), row("2026-03-05", "receipt", 20000)], rates, "2026-03-20", null, ["2026-01", "2026-02"]);
    expect(result.profit).toBe(80000);
    expect(result.taxSoFar).toBeCloseTo(19200, 2);
    expect(result.owedNow).toBeCloseTo(19200, 2);
  });

  test("the SME tiers apply only when the profile says sme", () => {
    const rows = [row("2026-02-10", "sales-invoice", 100000)];
    expect(position({ ...company, sme: true }, rows, rates, "2026-03-20", null, ["2026-01", "2026-02"]).taxSoFar).toBeCloseTo(15000, 2);
  });

  test("non-deductible, capital and personal expenses do not reduce profit", () => {
    const rows = [
      row("2026-02-01", "sales-invoice", 50000),
      row("2026-02-02", "receipt", 1000, { flags: ["non-deductible"] }),
      row("2026-02-03", "receipt", 2000, { flags: ["capital"] }),
      row("2026-02-04", "receipt", 3000, { flags: ["personal"] }),
      row("2026-02-05", "supplier-invoice", 4000),
    ];
    expect(position(company, rows, rates, "2026-02-28", null, ["2026-01", "2026-02"]).expenses).toBe(4000);
  });

  test("an opening row replaces everything before it, and later rows add to it", () => {
    const rows = [
      row("2026-01-15", "sales-invoice", 999999),
      row("2026-03-31", "opening", 60000),
      row("2026-04-10", "sales-invoice", 10000),
    ];
    expect(position(company, rows, rates, "2026-04-20", null).profit).toBe(70000);
  });

  test("only payments naming this YA count as paid; unlabelled ones are flagged", () => {
    const rows = [
      row("2026-02-10", "sales-invoice", 100000),
      row("2026-02-15", "tax-payment", 5000, { reference: "CP204 YA 2026 instalment 1" }),
      row("2026-03-01", "tax-payment", 7000, { reference: "Form C YA 2025 balance" }),
      row("2026-03-02", "tax-payment", 100),
    ];
    const result = position(company, rows, rates, "2026-03-20", null, ["2026-01", "2026-02"]);
    expect(result.paid).toBe(5000);
    expect(result.warnings.join(" ")).toContain("name no YA");
  });

  test("a foreign amount without its MYR value is left out and flagged, never guessed", () => {
    const rows = [row("2026-02-10", "sales-invoice", 1000, { currency: "USD" }), row("2026-02-11", "sales-invoice", 2000, { currency: "USD", amountMyr: 9400 })];
    const result = position(company, rows, rates, "2026-02-20", null, ["2026-01"]);
    expect(result.income).toBe(9400);
    expect(result.warnings.join(" ")).toContain("1 foreign-currency row");
  });

  test("a lone receipt does not make a company's year known: only a close or an opening figure does", () => {
    const result = position(company, [row("2026-09-14", "receipt", 4210.55, { flags: ["non-deductible"] })], rates, "2026-09-28", null);
    expect(result.known).toBe(false);
    expect(result.owedNow).toBeNull();
  });

  test("no data for the year means unknown, not zero", () => {
    const result = position(company, [row("2025-11-01", "sales-invoice", 5000)], rates, "2026-03-20", null);
    expect(result.known).toBe(false);
    expect(result.owedNow).toBeNull();
    expect(result.projectedTax).toBeNull();
    expect(result.missing.join(" ")).toContain("YA 2026");
  });

  test("projects the year from the months covered and prices the underestimation penalty", () => {
    const rows = [row("2026-01-10", "sales-invoice", 30000), row("2026-03-10", "sales-invoice", 30000)];
    const result = position(company, rows, rates, "2026-03-31", 0, ["2026-01", "2026-02", "2026-03"]);
    expect(result.monthsCovered).toBe(3);
    expect(result.projectedTax).toBeCloseTo(240000 * 0.24, 2);
    expect(result.monthlyTax).toBeCloseTo(4800, 2);
    expect(result.underestimationPenalty).toBeCloseTo(0.1 * (57600 - 0 - 0.3 * 57600), 2);
  });

  test("income in a month not yet closed counts toward owed now but not toward the projection", () => {
    const rows = [row("2026-01-31", "opening", 10000), row("2026-02-15", "sales-invoice", 10000)];
    const open = position(company, rows, rates, "2026-02-28", null, []);
    const closed = position(company, rows, rates, "2026-02-28", null, ["2026-02"]);
    expect(open.taxSoFar).toBeCloseTo(20000 * 0.24, 2);
    expect(open.projectedTax).toBeCloseTo(10000 * 12 * 0.24, 2);
    expect(closed.projectedTax).toBeCloseTo(20000 * 6 * 0.24, 2);
  });

  test("company zakat is a deduction capped at 2.5% of profit", () => {
    const rows = [row("2026-02-10", "sales-invoice", 100000), row("2026-02-11", "zakat", 5000)];
    expect(position(company, rows, rates, "2026-02-20", null, ["2026-01"]).taxSoFar).toBeCloseTo((100000 - 2500) * 0.24, 2);
  });
});

describe("position: individual", () => {
  test("salary and consulting income are taxed on the resident bands after relief, with PCB counted as paid", () => {
    const rows = [
      row("2026-01-31", "salary", 20000, { tax: 3000 }),
      row("2026-02-28", "salary", 20000, { tax: 3000 }),
      row("2026-02-15", "sales-invoice", 20000),
    ];
    const result = position(person, rows, rates, "2026-02-28", null);
    const expected = bandTax(60000 - 9000, rates.individual.resident);
    expect(result.taxSoFar).toBeCloseTo(expected, 2);
    expect(result.paid).toBe(6000);
    expect(result.owedNow).toBeCloseTo(Math.max(0, expected - 6000), 2);
  });

  test("zakat reduces tax ringgit for ringgit but never below zero", () => {
    const rows = [row("2026-01-31", "salary", 30000), row("2026-02-28", "salary", 30000), row("2026-02-28", "zakat", 99999)];
    expect(position(person, rows.slice(0, 2), rates, "2026-02-28", null).taxSoFar).toBeGreaterThan(0);
    expect(position(person, rows, rates, "2026-02-28", null).taxSoFar).toBe(0);
  });

  test("the RM400 rebate applies at or below RM35,000 chargeable", () => {
    const rows = [row("2026-01-31", "salary", 0), row("2026-02-28", "salary", 44000)];
    expect(position(person, rows, rates, "2026-02-28", null).taxSoFar).toBeCloseTo(Math.max(0, bandTax(35000, rates.individual.resident) - 400), 2);
  });

  test("an unconfirmed residence is computed as resident and says so", () => {
    const result = position({ ...person, resident: null }, [row("2026-02-28", "salary", 10000)], rates, "2026-02-28", null);
    expect(result.warnings.join(" ")).toContain("unconfirmed");
  });
});

describe("position: personal view", () => {
  const salaryYear = (pcb: number) =>
    Array.from({ length: 6 }, (_, i) => row(`2026-0${i + 1}-28`, "salary", 20000, { tax: pcb }));

  test("claimed reliefs count up to their cap, and profile reliefs apply only when confirmed", () => {
    const rows = [...salaryYear(2000), row("2026-03-01", "relief", 3000, { category: "lifestyle" }), row("2026-04-01", "relief", 1500, { category: "prs" })];
    const view = position({ ...person, spouseRelief: true, childrenUnder18: 3 }, rows, rates, "2026-06-30", null).personal;
    const byId = Object.fromEntries((view?.reliefs ?? []).map((line) => [line.id, line]));
    expect(byId.lifestyle.claimed).toBe(2500);
    expect(byId.lifestyle.status).toBe("full");
    expect(byId.prs.status).toBe("partial");
    expect(byId.spouse.claimed).toBe(4000);
    expect(byId["child-under-18"].claimed).toBe(6000);
    expect(view?.reliefTotal).toBe(9000 + 4000 + 6000 + 2500 + 1500);
  });

  test("an unconfirmed spouse or child count is shown as possible, not claimed", () => {
    const view = position(person, salaryYear(2000), rates, "2026-06-30", null).personal;
    const spouse = view?.reliefs.find((line) => line.id === "spouse");
    expect(spouse?.status).toBe("unconfirmed");
    expect(spouse?.claimed).toBe(0);
    expect(spouse?.worth).toBeGreaterThan(0);
    expect(view?.reliefTotal).toBe(9000);
  });

  test("an unused relief is priced at the operator's rate on the projected income", () => {
    const view = position(person, salaryYear(2000), rates, "2026-06-30", null).personal;
    const lifestyle = view?.reliefs.find((line) => line.id === "lifestyle");
    const projected = 240000 - 9000;
    expect(lifestyle?.worth).toBeCloseTo(bandTax(projected, rates.individual.resident) - bandTax(projected - 2500, rates.individual.resident), 2);
  });

  test("the filing balance is a refund when salary tax was over-withheld and a top-up when it was not", () => {
    const refund = position(person, salaryYear(6000), rates, "2026-06-30", null).personal;
    expect(refund?.filingBalance ?? 0).toBeLessThan(0);
    const topUp = position(person, [...salaryYear(1000), row("2026-05-15", "sales-invoice", 60000)], rates, "2026-06-30", null).personal;
    expect(topUp?.filingBalance ?? 0).toBeGreaterThan(0);
  });

  test("tax on income nobody withheld from is the extra tax the business income adds", () => {
    const rows = [...salaryYear(2000), row("2026-05-15", "sales-invoice", 30000)];
    const result = position(person, rows, rates, "2026-06-30", null);
    const withoutBusiness = bandTax(120000 - 9000, rates.individual.resident);
    const withBusiness = bandTax(150000 - 9000, rates.individual.resident);
    expect(result.personal?.unwithheldIncome).toBe(30000);
    expect(result.personal?.taxOnUnwithheld).toBeCloseTo(withBusiness - withoutBusiness, 2);
  });

  test("a relief row naming no known relief is left out and flagged", () => {
    const rows = [...salaryYear(2000), row("2026-03-01", "relief", 800, { category: "lifestlye" })];
    const result = position(person, rows, rates, "2026-06-30", null);
    expect(result.personal?.reliefTotal).toBe(9000);
    expect(result.warnings.join(" ")).toContain("1 relief row");
  });

  test("a payslip gap before the latest one leaves the year unpriced and names the missing months", () => {
    const juneOnly = position(person, [row("2026-06-30", "salary", 20000, { tax: 3000 })], rates, "2026-06-30", null);
    expect(juneOnly.known).toBe(false);
    expect(juneOnly.personal?.filingBalance).toBeNull();
    expect(juneOnly.missing.join(" ")).toContain("2026-01, 2026-02, 2026-03, 2026-04, 2026-05");
    const full = position(person, salaryYear(3000), rates, "2026-06-30", null);
    expect(full.known).toBe(true);
    expect(full.personal?.filingBalance ?? 0).toBeGreaterThan(0);
  });

  test("zero rows mark months without salary, and a mid-year starter projects from the months paid", () => {
    const rows = [
      ...["01", "02", "03", "04", "05"].map((month) => row(`2026-${month}-28`, "salary", 0)),
      row("2026-06-30", "salary", 20000, { tax: 3000 }),
    ];
    const result = position(person, rows, rates, "2026-06-30", null);
    expect(result.known).toBe(true);
    expect(result.projectedTax).toBeCloseTo(bandTax(20000 * 7 - 9000, rates.individual.resident), 2);
    expect(result.personal?.filingBalance).toBeCloseTo(bandTax(20000 * 7 - 9000, rates.individual.resident) - 3000 * 7, 2);
  });

  test("a company has no personal view", () => {
    expect(position(company, [], rates, "2026-06-30", null).personal).toBeNull();
  });
});

test("parseCsv reads quoted commas, doubled quotes and an optional amount_myr column", () => {
  const records = parseCsv('date,type,amount,currency,notes,amount_myr\n2026-02-01,sales-invoice,1000,USD,"a, ""quoted"" note",4700\n');
  const parsed = toLedgerRow(records[0]);
  expect(records[0].notes).toBe('a, "quoted" note');
  expect(parsed.amountMyr).toBe(4700);
  expect(parsed.currency).toBe("USD");
});
