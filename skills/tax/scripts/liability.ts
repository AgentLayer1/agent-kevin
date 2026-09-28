import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { type Entity, EntityKind } from "./calendar";

/**
 * The tax position engine: what each entity owes if its year ended today, what is already paid,
 * and where the year is heading. Reads the ledger and the country's `## Rates` block; never
 * guesses a missing figure (no data means unknown, not zero).
 */

export interface Band {
  upto?: number;
  rate: number;
}

export interface Rates {
  company: { flat: number; sme: Band[]; zakatCap: number };
  individual: { resident: Band[]; nonResident: number; selfRelief: number; rebate: { upto: number; amount: number } };
}

export const LedgerType = {
  SalesInvoice: "sales-invoice",
  Receipt: "receipt",
  SupplierInvoice: "supplier-invoice",
  Salary: "salary",
  TaxPayment: "tax-payment",
  Zakat: "zakat",
  Opening: "opening",
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
      selfRelief: numberAt(individual, "self_relief", "individual"),
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

const toNumber = (value: string | undefined): number => {
  const parsed = Number((value ?? "").replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

export const toLedgerRow = (record: Record<string, string>): LedgerRow => ({
  date: record.date ?? "",
  type: record.type ?? "",
  counterparty: record.counterparty ?? "",
  currency: (record.currency ?? "MYR").toUpperCase() || "MYR",
  amount: toNumber(record.amount),
  amountMyr: record.amount_myr ? toNumber(record.amount_myr) : null,
  tax: toNumber(record.tax),
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
    .flatMap((file) => parseCsv(readFileSync(join(dir, file), "utf8")).map(toLedgerRow));
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
}

const taxOn = (entity: Entity, rates: Rates, figures: Figures): number => {
  if (entity.kind === EntityKind.Company) {
    const profit = figures.business;
    const zakatDeduction = Math.min(figures.zakat, (Math.max(profit, 0) * rates.company.zakatCap) / 100);
    const chargeable = Math.max(0, profit - zakatDeduction);
    return entity.sme ? bandTax(chargeable, rates.company.sme) : (chargeable * rates.company.flat) / 100;
  }
  const total = Math.max(0, figures.business) + figures.employment;
  if (entity.resident === false) {
    return (total * rates.individual.nonResident) / 100;
  }
  const chargeable = Math.max(0, total - (entity.reliefs ?? rates.individual.selfRelief));
  const rebate = chargeable <= rates.individual.rebate.upto ? rates.individual.rebate.amount : 0;
  return Math.max(0, bandTax(chargeable, rates.individual.resident) - rebate - figures.zakat);
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
  const inPeriod = rows.filter((row) => row.date >= period.start && row.date <= period.end && row.date <= today);
  const opening = inPeriod
    .filter((row) => row.type === LedgerType.Opening)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  const counted = opening === undefined ? inPeriod : inPeriod.filter((row) => row.date > opening.date);
  const unconverted = counted.filter((row) => row.type !== LedgerType.Statement && myr(row) === null);
  const amountOf = (types: Set<string>, keep: (row: LedgerRow) => boolean = () => true): number =>
    sum(counted.filter((row) => types.has(row.type) && keep(row)).map((row) => myr(row) ?? 0));

  const income = amountOf(new Set([LedgerType.SalesInvoice]));
  const employment = amountOf(new Set([LedgerType.Salary]));
  const expenses = amountOf(EXPENSE_TYPES, isDeductible);
  const zakat = amountOf(new Set([LedgerType.Zakat]));
  const openingProfit = opening === undefined ? 0 : (myr(opening) ?? 0);
  const business = openingProfit + income - expenses;
  const pcb = sum(counted.filter((row) => row.type === LedgerType.Salary).map((row) => row.tax));
  const payments = rows.filter((row) => row.type === LedgerType.TaxPayment);
  const paymentsForYa = sum(payments.filter((row) => yaOf(row.reference) === period.ya).map((row) => myr(row) ?? 0));
  const unlabelledPayments = payments.filter((row) => yaOf(row.reference) === null);
  const paid = paymentsForYa + pcb;

  // A single row proves nothing about completeness: a company's books are complete through a closed
  // month or the accountant's opening figure; an individual with no monthly close, through the last
  // month that has income recorded.
  const incomeMonths =
    entity.close === "none"
      ? inPeriod
          .filter((row) => row.type === LedgerType.Salary || row.type === LedgerType.SalesInvoice)
          .map((row) => row.date.slice(0, 7))
      : [];
  const coverageMonths = [
    ...(opening === undefined ? [] : [opening.date.slice(0, 7)]),
    ...closedMonths.filter((month) => month >= period.start.slice(0, 7) && month <= today.slice(0, 7)),
    ...incomeMonths,
  ].sort();
  const coverage = coverageMonths.at(-1) ?? null;
  const known = coverage !== null;
  const monthsCovered = coverage === null ? 0 : monthsBetween(period.start.slice(0, 7), coverage);
  const taxSoFar = known ? taxOn(entity, rates, { business, employment, zakat }) : 0;
  const scale = monthsCovered > 0 ? periodMonths / monthsCovered : 0;
  const projectedTax = known ? taxOn(entity, rates, { business: business * scale, employment: employment * scale, zakat }) : null;
  const projectedPaid = paymentsForYa + pcb * scale;
  const underestimation =
    entity.kind === EntityKind.Company && projectedTax !== null && estimateOnFile !== null
      ? Math.max(0, 0.1 * (projectedTax - estimateOnFile - 0.3 * projectedTax))
      : null;

  const lastFullMonth = (() => {
    const [year, month] = today.split("-").map(Number);
    const index = year * 12 + month - 2;
    return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
  })();
  const missing = [
    ...(known
      ? []
      : [
          entity.close === "none"
            ? `no income recorded for YA ${period.ya} yet`
            : `no closed month or opening figure from the accountant for YA ${period.ya} yet`,
        ]),
    ...(known && coverage !== null && coverage < lastFullMonth && lastFullMonth >= period.start.slice(0, 7)
      ? [`books are complete only through ${coverage}; months after it up to ${lastFullMonth} are not closed`]
      : []),
  ];
  const warnings = [
    ...(unconverted.length > 0
      ? [`${unconverted.length} foreign-currency row(s) have no amount_myr and are left out of the totals`]
      : []),
    ...(unlabelledPayments.length > 0
      ? [`${unlabelledPayments.length} tax payment(s) name no YA in their reference and are not counted as paid`]
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
    monthlyTax: projectedTax === null ? null : projectedTax / periodMonths,
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

const closedMonths = (taxDir: string, slug: string): string[] => {
  const dir = join(taxDir, "closes", slug);
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => /^\d{4}-\d{2}\.md$/.test(file))
        .map((file) => basename(file, ".md"))
    : [];
};

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
