import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Entity, EntityKind } from "./calendar";
import { loadCloses } from "./closes";

/**
 * The tax position engine: what each entity owes if its year ended today, what is already paid,
 * and where the year is heading. Reads the ledger and the country's `## Rates` block; never
 * guesses a missing figure (no data means unknown, not zero).
 */

export interface Band {
  upto?: number;
  rate: number;
}

export const ReliefBasis = { Automatic: "automatic", Profile: "profile", PerChild: "per-child", Claimed: "claimed" } as const;
export type ReliefBasis = (typeof ReliefBasis)[keyof typeof ReliefBasis];

export interface ReliefCap {
  id: string;
  title: string;
  cap: number;
  basis: ReliefBasis;
  within: string | null;
}

export interface Rates {
  company: { flat: number; sme: Band[]; zakatCap: number };
  individual: { resident: Band[]; nonResident: number; reliefs: ReliefCap[]; rebate: { upto: number; amount: number } };
}

export const LedgerType = {
  SalesInvoice: "sales-invoice",
  Receipt: "receipt",
  SupplierInvoice: "supplier-invoice",
  Salary: "salary",
  TaxPayment: "tax-payment",
  Zakat: "zakat",
  Opening: "opening",
  Relief: "relief",
  Statement: "statement",
} as const;
export type LedgerType = (typeof LedgerType)[keyof typeof LedgerType];

export interface LedgerRow {
  date: string;
  type: string;
  counterparty: string;
  currency: string;
  amount: number;
  amountMyr: number | null;
  tax: number;
  reference: string;
  category: string;
  flags: string[];
}

export const ReliefStatus = { Full: "full", Partial: "partial", Open: "open", Unconfirmed: "unconfirmed" } as const;
export type ReliefStatus = (typeof ReliefStatus)[keyof typeof ReliefStatus];

export interface ReliefLine {
  id: string;
  title: string;
  within: string | null;
  cap: number;
  claimed: number;
  status: ReliefStatus;
  worth: number;
}

/**
 * What matters for an individual whose salary tax is withheld at source: the refund or top-up at
 * filing, the tax on income nobody withheld from, and the reliefs still open.
 */
export interface PersonalView {
  withheld: number;
  unwithheldIncome: number;
  taxOnUnwithheld: number;
  reliefs: ReliefLine[];
  reliefTotal: number;
  filingBalance: number | null;
  effectiveRate: number | null;
}

export interface Position {
  entity: string;
  name: string;
  kind: EntityKind;
  ya: number;
  period: { start: string; end: string };
  known: boolean;
  coverage: string | null;
  monthsCovered: number;
  periodMonths: number;
  carriedIn: number;
  carriedInTo: string | null;
  personal: PersonalView | null;
  income: number;
  employment: number;
  expenses: number;
  profit: number;
  taxSoFar: number;
  paid: number;
  owedNow: number | null;
  aheadBy: number;
  projectedTax: number | null;
  monthlyTax: number | null;
  stillToPay: number | null;
  estimateOnFile: number | null;
  underestimationPenalty: number | null;
  warnings: string[];
  missing: string[];
}

const RATES_RE = /^## Rates[^\n]*\n(?:(?!^## )[\s\S])*?^```ya?ml\r?\n([\s\S]*?)^```/m;
const NOT_DEDUCTIBLE = new Set(["non-deductible", "capital", "personal"]);
export const EXPENSE_TYPES = new Set<string>([LedgerType.Receipt, LedgerType.SupplierInvoice]);

export const isDeductible = (row: LedgerRow): boolean => !row.flags.some((flag) => NOT_DEDUCTIBLE.has(flag));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toBands = (value: unknown, where: string): Band[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Rates: ${where} needs a list of bands`);
  }
  return value.map((band, i) => {
    if (!isRecord(band) || typeof band.rate !== "number") {
      throw new Error(`Rates: ${where} band ${i + 1} needs a numeric rate`);
    }
    return typeof band.upto === "number" ? { upto: band.upto, rate: band.rate } : { rate: band.rate };
  });
};

const numberAt = (record: Record<string, unknown>, key: string, where: string): number => {
  const value = record[key];
  if (typeof value !== "number") {
    throw new Error(`Rates: ${where}.${key} must be a number`);
  }
  return value;
};

const BASES = new Set<string>(Object.values(ReliefBasis));

const toReliefs = (value: unknown): ReliefCap[] => {
  if (!Array.isArray(value) || !value.some((item) => isRecord(item) && item.id === "self")) {
    throw new Error("Rates: individual.reliefs needs a list that includes the self relief");
  }
  const reliefs = value.map((item, i): ReliefCap => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.title !== "string" || typeof item.cap !== "number") {
      throw new Error(`Rates: individual.reliefs entry ${i + 1} needs id, title and a numeric cap`);
    }
    const basis = typeof item.basis === "string" && BASES.has(item.basis) ? (item.basis as ReliefBasis) : ReliefBasis.Claimed;
    return { id: item.id, title: item.title, cap: item.cap, basis, within: typeof item.within === "string" ? item.within : null };
  });
  const ids = new Set(reliefs.map((relief) => relief.id));
  const orphan = reliefs.find((relief) => relief.within !== null && !ids.has(relief.within));
  if (orphan !== undefined) {
    throw new Error(`Rates: individual.reliefs entry ${orphan.id} is within ${orphan.within}, which is not a relief`);
  }
  return reliefs;
};

export const parseRates = (markdown: string): Rates => {
  const block = markdown.match(RATES_RE)?.[1];
  const data: unknown = block === undefined ? null : Bun.YAML.parse(block);
  if (!isRecord(data) || !isRecord(data.company) || !isRecord(data.individual)) {
    throw new Error("Rates: the country reference needs a ## Rates yaml block with company and individual");
  }
  const { company, individual } = data;
  const rebate = isRecord(individual.rebate) ? individual.rebate : {};
  return {
    company: {
      flat: numberAt(company, "flat", "company"),
      sme: toBands(company.sme, "company.sme"),
      zakatCap: numberAt(company, "zakat_cap", "company"),
    },
    individual: {
      resident: toBands(individual.resident, "individual.resident"),
      nonResident: numberAt(individual, "non_resident", "individual"),
      reliefs: toReliefs(individual.reliefs),
      rebate: { upto: numberAt(rebate, "upto", "individual.rebate"), amount: numberAt(rebate, "amount", "individual.rebate") },
    },
  };
};

export const loadRates = (countriesDir: string, country: string): Rates =>
  parseRates(readFileSync(join(countriesDir, `${country}.md`), "utf8"));

/**
 * Tax on `income` across progressive bands, each band taxing the slice up to its `upto`.
 */
export const bandTax = (income: number, bands: Band[]): number =>
  bands.reduce(
    (acc, band) => {
      const top = band.upto ?? Number.POSITIVE_INFINITY;
      const slice = Math.max(0, Math.min(income, top) - acc.floor);
      return { floor: top, tax: acc.tax + (slice * band.rate) / 100 };
    },
    { floor: 0, tax: 0 }
  ).tax;

/**
 * Minimal RFC 4180 reader: quoted fields may hold commas, newlines, and doubled quotes.
 */
export const parseCsv = (text: string): Record<string, string>[] => {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") {
        i++;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header = [], ...body] = rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
  return body.map((cells) => Object.fromEntries(header.map((key, i) => [key.trim(), (cells[i] ?? "").trim()])));
};

/**
 * A money cell as a number: blank is 0, a plain number with thousands commas is read, and anything
 * else ("RM 100000") throws rather than silently becoming 0.
 */
const toNumber = (value: string | undefined, column: string): number => {
  const text = (value ?? "").trim();
  if (text === "") {
    return 0;
  }
  const parsed = Number(text.replaceAll(",", ""));
  if (!Number.isFinite(parsed)) {
    throw new Error(`${column} "${text}" is not a number`);
  }
  return parsed;
};

export const toLedgerRow = (record: Record<string, string>): LedgerRow => ({
  date: record.date ?? "",
  type: record.type ?? "",
  counterparty: record.counterparty ?? "",
  currency: (record.currency ?? "MYR").toUpperCase() || "MYR",
  amount: toNumber(record.amount, "amount"),
  amountMyr: record.amount_myr?.trim() ? toNumber(record.amount_myr, "amount_myr") : null,
  tax: toNumber(record.tax, "tax"),
  reference: record.reference ?? "",
  category: record.category ?? "",
  flags: (record.flags ?? "")
    .split(/[;|]/)
    .map((flag) => flag.trim())
    .filter((flag) => flag !== ""),
});

export const loadLedger = (taxDir: string, slug: string): LedgerRow[] => {
  const dir = join(taxDir, "ledger", slug);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((file) => file.endsWith(".csv"))
    .sort()
    .flatMap((file) =>
      parseCsv(readFileSync(join(dir, file), "utf8")).map((record, i) => {
        try {
          return toLedgerRow(record);
        } catch (error) {
          throw new Error(`ledger/${slug}/${file} row ${i + 2}: ${error instanceof Error ? error.message : String(error)}`);
        }
      })
    );
};

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * The basis period containing `today` for a financial year ending on `fye` (MM-DD); the YA is the
 * year the period ends in.
 */
export const periodFor = (fye: string, today: string): { start: string; end: string; ya: number } => {
  const [month, day] = fye.split("-").map(Number);
  const year = Number(today.slice(0, 4));
  const endThisYear = `${year}-${pad(month)}-${pad(day)}`;
  const endYear = today <= endThisYear ? year : year + 1;
  const end = `${endYear}-${pad(month)}-${pad(day)}`;
  const startDate = new Date(Date.UTC(endYear - 1, month - 1, day + 1));
  return { start: startDate.toISOString().slice(0, 10), end, ya: endYear };
};

const monthsBetween = (fromMonth: string, toMonth: string): number => {
  const [fy, fm] = fromMonth.split("-").map(Number);
  const [ty, tm] = toMonth.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
};

const monthsFrom = (fromMonth: string, count: number): string[] => {
  const [year, month] = fromMonth.split("-").map(Number);
  return Array.from({ length: Math.max(0, count) }, (_, i) => {
    const index = year * 12 + month - 1 + i;
    return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
  });
};

const monthEnd = (month: string): string => {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${month}-${pad(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate())}`;
};

const myr = (row: LedgerRow): number | null => row.amountMyr ?? (row.currency === "MYR" ? row.amount : null);

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

const yaOf = (reference: string): number | null => {
  const match = reference.match(/\bYA\s*(\d{4})\b/i);
  return match ? Number(match[1]) : null;
};

interface Figures {
  business: number;
  employment: number;
  zakat: number;
  reliefs: number;
}

const individualTax = (rates: Rates, resident: boolean | null, total: number, reliefs: number, zakat: number): number => {
  if (resident === false) {
    return (total * rates.individual.nonResident) / 100;
  }
  const chargeable = Math.max(0, total - reliefs);
  const rebate = chargeable <= rates.individual.rebate.upto ? rates.individual.rebate.amount : 0;
  return Math.max(0, bandTax(chargeable, rates.individual.resident) - rebate - zakat);
};

/**
 * Each relief with what's claimed against its cap, and what filling the rest would save at the
 * projected income. A sublimit (`within` a parent) is capped on its own and also counts against
 * its parent's cap, so dental spending can never use the whole medical allowance.
 */
const reliefLines = (entity: Entity, rates: Rates, rows: LedgerRow[], projectedIncome: number, zakat: number): ReliefLine[] => {
  const reliefs = rates.individual.reliefs;
  const spentOn = (id: string): number =>
    sum(rows.filter((row) => row.type === LedgerType.Relief && row.category === id).map((row) => myr(row) ?? 0));
  const statusOf = (claimed: number, cap: number): ReliefStatus =>
    claimed >= cap ? ReliefStatus.Full : claimed > 0 ? ReliefStatus.Partial : ReliefStatus.Open;
  const subClaimed = new Map(
    reliefs.filter((relief) => relief.within !== null).map((relief) => [relief.id, Math.min(relief.cap, spentOn(relief.id))])
  );
  const base = reliefs.map((relief): Omit<ReliefLine, "worth"> => {
    if (relief.basis === ReliefBasis.Automatic) {
      return { ...relief, claimed: relief.cap, status: ReliefStatus.Full };
    }
    if (relief.basis === ReliefBasis.Profile) {
      return entity.spouseRelief === null
        ? { ...relief, claimed: 0, status: ReliefStatus.Unconfirmed }
        : { ...relief, claimed: entity.spouseRelief ? relief.cap : 0, status: entity.spouseRelief ? ReliefStatus.Full : ReliefStatus.Open };
    }
    if (relief.basis === ReliefBasis.PerChild) {
      return entity.childrenUnder18 === null
        ? { ...relief, claimed: 0, status: ReliefStatus.Unconfirmed }
        : { ...relief, cap: relief.cap * entity.childrenUnder18, claimed: relief.cap * entity.childrenUnder18, status: ReliefStatus.Full };
    }
    if (relief.within !== null) {
      const claimed = subClaimed.get(relief.id) ?? 0;
      return { ...relief, claimed, status: statusOf(claimed, relief.cap) };
    }
    const fromSubs = sum(reliefs.filter((child) => child.within === relief.id).map((child) => subClaimed.get(child.id) ?? 0));
    const claimed = Math.min(relief.cap, spentOn(relief.id) + fromSubs);
    return { ...relief, claimed, status: statusOf(claimed, relief.cap) };
  });
  const total = sum(base.filter((line) => line.within === null).map((line) => line.claimed));
  const headroom = (line: Omit<ReliefLine, "worth">): number => {
    const own = line.status === ReliefStatus.Unconfirmed ? line.cap : line.cap - line.claimed;
    const parent = base.find((candidate) => candidate.id === line.within);
    return parent === undefined ? own : Math.min(own, parent.cap - parent.claimed);
  };
  const taxAt = (reliefs: number): number => individualTax(rates, entity.resident, projectedIncome, reliefs, zakat);
  return base.map((line) => ({
    ...line,
    worth: line.status === ReliefStatus.Full ? 0 : Math.max(0, taxAt(total) - taxAt(total + Math.max(0, headroom(line)))),
  }));
};

const taxOn = (entity: Entity, rates: Rates, figures: Figures): number => {
  if (entity.kind === EntityKind.Company) {
    const profit = figures.business;
    const zakatDeduction = Math.min(figures.zakat, (Math.max(profit, 0) * rates.company.zakatCap) / 100);
    const chargeable = Math.max(0, profit - zakatDeduction);
    return entity.sme ? bandTax(chargeable, rates.company.sme) : (chargeable * rates.company.flat) / 100;
  }
  return individualTax(rates, entity.resident, Math.max(0, figures.business) + figures.employment, figures.reliefs, figures.zakat);
};

/**
 * One entity's position for the basis period containing `today`.
 */
export const position = (
  entity: Entity,
  rows: LedgerRow[],
  rates: Rates,
  today: string,
  estimateOnFile: number | null,
  closedMonths: string[] = []
): Position => {
  const period = periodFor(entity.fye, today);
  const periodMonths = monthsBetween(period.start.slice(0, 7), period.end.slice(0, 7));
  // A company that started during the period is only asked for, and projected over, the months it
  // existed.
  const startedMonth = entity.startedOn?.slice(0, 7) ?? null;
  const activeStart =
    startedMonth !== null && startedMonth > period.start.slice(0, 7) && startedMonth <= period.end.slice(0, 7)
      ? startedMonth
      : period.start.slice(0, 7);
  const activeMonths = monthsBetween(activeStart, period.end.slice(0, 7));
  const inPeriod = rows.filter((row) => row.date >= period.start && row.date <= period.end && row.date <= today);
  // An opening is a company's management-accounts profit to date; on a personal return it would
  // replace salary and PCB it never summarised, so it is ignored there and flagged.
  const openings = inPeriod.filter((row) => row.type === LedgerType.Opening);
  const isCompany = entity.kind === EntityKind.Company;
  const ignoredOpenings = isCompany ? [] : openings;
  const opening = isCompany ? [...openings].sort((a, b) => a.date.localeCompare(b.date)).at(-1) : undefined;
  const counted = opening === undefined ? inPeriod : inPeriod.filter((row) => row.date > opening.date);
  const unconverted = counted.filter(
    (row) => row.type !== LedgerType.Statement && row.type !== LedgerType.Opening && myr(row) === null
  );
  const amountOf = (types: Set<string>, keep: (row: LedgerRow) => boolean = () => true): number =>
    sum(counted.filter((row) => types.has(row.type) && keep(row)).map((row) => myr(row) ?? 0));

  const income = amountOf(new Set([LedgerType.SalesInvoice]));
  const employment = amountOf(new Set([LedgerType.Salary]));
  const expenses = amountOf(EXPENSE_TYPES, isDeductible);
  const zakat = amountOf(new Set([LedgerType.Zakat]));
  const openingProfit = opening === undefined ? 0 : (myr(opening) ?? 0);
  const business = openingProfit + income - expenses;
  const pcb = sum(counted.filter((row) => row.type === LedgerType.Salary).map((row) => row.tax));
  const payments = rows.filter((row) => row.type === LedgerType.TaxPayment && row.date <= today);
  const paymentsForYa = sum(payments.filter((row) => yaOf(row.reference) === period.ya).map((row) => myr(row) ?? 0));
  const unlabelledPayments = payments.filter((row) => yaOf(row.reference) === null);
  const paid = paymentsForYa + pcb;

  // A single record proves nothing about the months before it. Books are complete through an
  // unbroken run of complete closes from the period start or the month the company started (or the
  // month after the accountant's opening figure); an individual with no monthly close, through the
  // last month with income.
  const lastFullMonth = (() => {
    const [year, month] = today.split("-").map(Number);
    const index = year * 12 + month - 2;
    return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
  })();
  const closedSet = new Set(closedMonths);
  // An opening dated on its month's last day speaks for that whole month; one dated mid-month does
  // not, so that month still needs its own complete close.
  const runStart =
    opening === undefined
      ? activeStart
      : opening.date === monthEnd(opening.date.slice(0, 7))
        ? monthsFrom(opening.date.slice(0, 7), 2)[1]
        : opening.date.slice(0, 7);
  const run = monthsFrom(runStart, Math.max(0, monthsBetween(runStart, today.slice(0, 7))));
  const brokenAt = run.findIndex((month) => !closedSet.has(month));
  const closedRun = brokenAt === -1 ? run : run.slice(0, brokenAt);
  const incomeMonths =
    entity.close === "none"
      ? inPeriod
          .filter((row) => row.type === LedgerType.Salary || row.type === LedgerType.SalesInvoice)
          .map((row) => row.date.slice(0, 7))
      : [];
  const coverageMonths = [
    ...(opening === undefined ? [] : [opening.date.slice(0, 7)]),
    ...closedRun.slice(-1),
    ...incomeMonths,
  ].sort();
  const coverage = coverageMonths.at(-1) ?? null;
  const monthsCovered = coverage === null ? 0 : monthsBetween(activeStart, coverage);
  // Once an individual records any salary, every month through the latest payslip, and every month
  // that has ended since, needs a salary row (a 0 row for a month without one). The month in
  // progress never needs one before payday.
  const salaryMonths = new Set(counted.filter((row) => row.type === LedgerType.Salary).map((row) => row.date.slice(0, 7)));
  const lastSalaryMonth = [...salaryMonths].sort().at(-1) ?? null;
  const salaryThrough = lastSalaryMonth === null ? null : [lastFullMonth, lastSalaryMonth].sort().at(-1) ?? null;
  const salaryGaps =
    entity.close === "none" && salaryThrough !== null
      ? monthsFrom(activeStart, monthsBetween(activeStart, salaryThrough)).filter(
          (month) => !salaryMonths.has(month) && (opening === undefined || month > opening.date.slice(0, 7))
        )
      : [];
  // An opening figure in another currency with no MYR value cannot price anything, and must not
  // stand in for the months it summarises.
  const openingUnconverted = opening !== undefined && myr(opening) === null;
  const known = coverage !== null && salaryGaps.length === 0 && !openingUnconverted;

  // Income, expenses, salary and PCB are annualised, so only what the covered months hold is
  // projected: a transaction in a month not yet closed is never spread over fewer months than it
  // belongs to. Amounts actually paid (zakat, relief spending, tax payments) count whenever paid.
  const covered = coverage === null ? [] : counted.filter((row) => row.date <= monthEnd(coverage));
  const coveredOf = (types: Set<string>, keep: (row: LedgerRow) => boolean = () => true): number =>
    sum(covered.filter((row) => types.has(row.type) && keep(row)).map((row) => myr(row) ?? 0));
  const coveredSalary = covered.filter((row) => row.type === LedgerType.Salary);
  const paidMonths = new Set(coveredSalary.filter((row) => (myr(row) ?? 0) > 0).map((row) => row.date.slice(0, 7))).size;
  const salaryMonthsCovered = salaryThrough === null ? monthsCovered : monthsBetween(activeStart, salaryThrough);
  const remaining = Math.max(0, activeMonths - salaryMonthsCovered);
  const extend = (total: number): number => total + (paidMonths > 0 ? (total / paidMonths) * remaining : 0);
  const businessProjected =
    (openingProfit + coveredOf(new Set([LedgerType.SalesInvoice])) - coveredOf(EXPENSE_TYPES, isDeductible)) *
    (monthsCovered > 0 ? activeMonths / monthsCovered : 0);
  const employmentProjected = extend(sum(coveredSalary.map((row) => myr(row) ?? 0)));
  const pcbProjected = extend(sum(coveredSalary.map((row) => row.tax)));
  const projectedIncome = Math.max(0, businessProjected) + employmentProjected;
  const lines = entity.kind === EntityKind.Individual ? reliefLines(entity, rates, inPeriod, projectedIncome, zakat) : [];
  const reliefTotal = sum(lines.filter((line) => line.within === null).map((line) => line.claimed));
  const taxSoFar = known ? taxOn(entity, rates, { business, employment, zakat, reliefs: reliefTotal }) : 0;
  const projectedTax = known
    ? taxOn(entity, rates, { business: businessProjected, employment: employmentProjected, zakat, reliefs: reliefTotal })
    : null;
  const personal: PersonalView | null =
    entity.kind === EntityKind.Individual
      ? {
          withheld: pcb,
          unwithheldIncome: Math.max(0, business),
          taxOnUnwithheld: known
            ? Math.max(0, taxSoFar - taxOn(entity, rates, { business: 0, employment, zakat, reliefs: reliefTotal }))
            : 0,
          reliefs: lines,
          reliefTotal,
          filingBalance: projectedTax === null ? null : projectedTax - (paymentsForYa + pcbProjected),
          effectiveRate: projectedTax === null || projectedIncome <= 0 ? null : projectedTax / projectedIncome,
        }
      : null;
  const projectedPaid = paymentsForYa + pcbProjected;
  const underestimation =
    entity.kind === EntityKind.Company && projectedTax !== null && estimateOnFile !== null
      ? Math.max(0, 0.1 * (projectedTax - estimateOnFile - 0.3 * projectedTax))
      : null;

  const missing = [
    ...(coverage !== null
      ? []
      : [
          entity.close === "none"
            ? `no income recorded for YA ${period.ya} yet`
            : `no closed month or opening figure from the accountant for YA ${period.ya} yet`,
        ]),
    ...(openingUnconverted && opening !== undefined
      ? [`the opening figure dated ${opening.date} is in ${opening.currency} with no amount_myr: add its MYR value`]
      : []),
    ...(salaryGaps.length > 0
      ? [`no salary recorded for ${salaryGaps.join(", ")}: add each payslip, or a 0 salary row for a month without one`]
      : []),
    ...(known && coverage !== null && coverage < lastFullMonth && lastFullMonth >= period.start.slice(0, 7)
      ? [`books are complete only through ${coverage}; months after it up to ${lastFullMonth} are not closed`]
      : []),
  ];
  const reliefIds = new Set(rates.individual.reliefs.map((relief) => relief.id));
  const strayReliefs = inPeriod.filter((row) => row.type === LedgerType.Relief && !reliefIds.has(row.category));
  const warnings = [
    ...(unconverted.length > 0
      ? [`${unconverted.length} foreign-currency row(s) have no amount_myr and are left out of the totals`]
      : []),
    ...(unlabelledPayments.length > 0
      ? [`${unlabelledPayments.length} tax payment(s) name no YA in their reference and are not counted as paid`]
      : []),
    ...(ignoredOpenings.length > 0
      ? [`${ignoredOpenings.length} opening row(s) ignored: an opening figure is a company's management accounts, not a personal return`]
      : []),
    ...(strayReliefs.length > 0
      ? [`${strayReliefs.length} relief row(s) name no known relief in their category and are not counted`]
      : []),
    ...(entity.kind === EntityKind.Individual && entity.resident === null
      ? ["residence for this year is unconfirmed; computed as a resident"]
      : []),
  ];

  return {
    entity: entity.slug,
    name: entity.name,
    kind: entity.kind,
    ya: period.ya,
    period: { start: period.start, end: period.end },
    known,
    coverage,
    monthsCovered,
    periodMonths,
    personal,
    carriedIn: openingProfit,
    carriedInTo: opening === undefined ? null : opening.date,
    income,
    employment,
    expenses,
    profit: business + employment,
    taxSoFar,
    paid,
    owedNow: known ? Math.max(0, taxSoFar - paid) : null,
    aheadBy: known ? Math.max(0, paid - taxSoFar) : 0,
    projectedTax,
    monthlyTax: projectedTax === null ? null : projectedTax / activeMonths,
    stillToPay: projectedTax === null ? null : Math.max(0, projectedTax - projectedPaid),
    estimateOnFile,
    underestimationPenalty: underestimation !== null && underestimation > 0 ? underestimation : null,
    warnings,
    missing,
  };
};

const estimateFiled = (taxDir: string, slug: string, ya: number): number | null => {
  const path = join(taxDir, "estimates", slug, `${ya}.md`);
  if (!existsSync(path)) {
    return null;
  }
  const block = readFileSync(path, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  const data: unknown = block === undefined ? null : Bun.YAML.parse(block);
  return isRecord(data) && typeof data.filed === "number" ? data.filed : null;
};

/**
 * Months whose close is complete. A partial close, or one with open gaps, has unpriced lines in
 * it, so it never counts as covered.
 */
const closedMonths = (taxDir: string, slug: string): string[] =>
  loadCloses(taxDir, slug)
    .filter((record) => record.status === "closed" && record.gaps.length === 0)
    .map((record) => record.month);

/**
 * Every entity's position, in the order given.
 */
export const positions = (taxDir: string, countriesDir: string, entities: Entity[], today: string): Position[] =>
  entities.map((entity) =>
    position(
      entity,
      loadLedger(taxDir, entity.slug),
      loadRates(countriesDir, entity.country),
      today,
      estimateFiled(taxDir, entity.slug, periodFor(entity.fye, today).ya),
      closedMonths(taxDir, entity.slug)
    )
  );
