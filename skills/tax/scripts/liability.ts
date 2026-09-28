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
  return value.map((item, i) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.title !== "string" || typeof item.cap !== "number") {
      throw new Error(`Rates: individual.reliefs entry ${i + 1} needs id, title and a numeric cap`);
    }
    const basis = typeof item.basis === "string" && BASES.has(item.basis) ? (item.basis as ReliefBasis) : ReliefBasis.Claimed;
    return { id: item.id, title: item.title, cap: item.cap, basis };
  });
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
 * projected income: fixed reliefs from the profile, claimed ones from `relief` ledger rows.
 */
const reliefLines = (entity: Entity, rates: Rates, rows: LedgerRow[], projectedIncome: number, zakat: number): ReliefLine[] => {
  const claimedOf = (id: string): number =>
    sum(rows.filter((row) => row.type === LedgerType.Relief && row.category === id).map((row) => myr(row) ?? 0));
  const base = rates.individual.reliefs.map((relief): Omit<ReliefLine, "worth"> => {
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
    const claimed = Math.min(relief.cap, claimedOf(relief.id));
    const status = claimed >= relief.cap ? ReliefStatus.Full : claimed > 0 ? ReliefStatus.Partial : ReliefStatus.Open;
    return { ...relief, claimed, status };
  });
  const total = sum(base.map((line) => line.claimed));
  const taxAt = (reliefs: number): number => individualTax(rates, entity.resident, projectedIncome, reliefs, zakat);
  return base.map((line) => ({
    ...line,
    worth: line.status === ReliefStatus.Full ? 0 : Math.max(0, taxAt(total) - taxAt(total + (line.status === ReliefStatus.Unconfirmed ? line.cap : line.cap - line.claimed))),
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
  const scaleFor = (months: number): number => (months > 0 ? periodMonths / months : 0);
  const projectedIncome = (Math.max(0, business) + employment) * scaleFor(monthsCovered);
  const lines = entity.kind === EntityKind.Individual ? reliefLines(entity, rates, inPeriod, projectedIncome, zakat) : [];
  const reliefTotal = sum(lines.map((line) => line.claimed));
  const taxSoFar = known ? taxOn(entity, rates, { business, employment, zakat, reliefs: reliefTotal }) : 0;
  const scale = scaleFor(monthsCovered);
  const projectedTax = known
    ? taxOn(entity, rates, { business: business * scale, employment: employment * scale, zakat, reliefs: reliefTotal })
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
          filingBalance: projectedTax === null ? null : projectedTax - (paymentsForYa + pcb * scale),
          effectiveRate: projectedTax === null || projectedIncome <= 0 ? null : projectedTax / projectedIncome,
        }
      : null;
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
  const reliefIds = new Set(rates.individual.reliefs.map((relief) => relief.id));
  const strayReliefs = inPeriod.filter((row) => row.type === LedgerType.Relief && !reliefIds.has(row.category));
  const warnings = [
    ...(unconverted.length > 0
      ? [`${unconverted.length} foreign-currency row(s) have no amount_myr and are left out of the totals`]
      : []),
    ...(unlabelledPayments.length > 0
      ? [`${unlabelledPayments.length} tax payment(s) name no YA in their reference and are not counted as paid`]
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
