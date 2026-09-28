import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import {
  addDays,
  type Entity,
  EntityKind,
  type ExistingTask,
  loadEntities,
  loadExisting,
  loadOneOffs,
  type Occurrence,
  occurrences,
  stateOf,
  TaskState,
} from "./calendar";
import {
  EXPENSE_TYPES,
  isDeductible,
  type LedgerRow,
  loadLedger,
  type PersonalView,
  type Position,
  positions,
  type ReliefLine,
  ReliefStatus,
} from "./liability";

/**
 * The tax project's dashboard: one static page, no JavaScript (tabs are radio inputs styled with
 * CSS, so it works in viewers that block scripts). Pure: identical inputs and `today` give
 * byte-identical output.
 */

const COUNTRIES_DIR = join(import.meta.dir, "..", "references", "countries");
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SLOTS = 3;

const escapeHtml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const money = (amount: number, decimals = 0): string =>
  `RM ${amount.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;

const moneyOrDash = (amount: number | null): string => (amount === null ? "—" : money(amount));

const monthKeys = (fromMonth: string, count: number): string[] => {
  const [year, month] = fromMonth.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const index = year * 12 + (month - 1) + i;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  });
};

const monthLabel = (key: string, withYear = true): string => {
  const [year, month] = key.split("-").map(Number);
  return withYear ? `${MONTH_NAMES[month - 1]} ${year}` : MONTH_NAMES[month - 1];
};

const lastDay = (key: string): string => {
  const [year, month] = key.split("-").map(Number);
  return `${key}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
};

const dayLabel = (date: string): string => `${Number(date.slice(8))} ${MONTH_NAMES[Number(date.slice(5, 7)) - 1]}`;

const slug = (entity: string): string => entity.replace(/[^a-z0-9-]/gi, "-").toLowerCase();

/**
 * Companies first, then individuals, each alphabetical. The order fixes each entity's colour, so a
 * colour always means the same entity.
 */
export const orderEntities = (entities: Entity[]): Entity[] =>
  [...entities].sort(
    (a, b) =>
      Number(a.kind === EntityKind.Individual) - Number(b.kind === EntityKind.Individual) || a.name.localeCompare(b.name)
  );

const STATE_META: Record<TaskState, { icon: string; label: string }> = {
  [TaskState.Done]: { icon: "✓", label: "Done" },
  [TaskState.Open]: { icon: "●", label: "Open" },
  [TaskState.Overdue]: { icon: "!", label: "Overdue" },
  [TaskState.Upcoming]: { icon: "○", label: "Not yet a task" },
  [TaskState.Skipped]: { icon: "–", label: "Skipped" },
};

const soon = (occurrence: Occurrence, state: TaskState, today: string): boolean =>
  (state === TaskState.Open || state === TaskState.Upcoming) && occurrence.due <= addDays(today, 14);

const statusTag = (occurrence: Occurrence, state: TaskState, today: string): string => {
  const due = soon(occurrence, state, today) ? "soon" : state;
  const meta = due === "soon" ? { icon: "◷", label: "Due soon" } : STATE_META[state];
  return `<span class="tag ${due}"><span aria-hidden="true">${meta.icon}</span> ${meta.label}</span>`;
};

interface MonthFlow {
  month: string;
  income: number;
  expenses: number;
}

const myr = (row: LedgerRow): number | null => row.amountMyr ?? (row.currency === "MYR" ? row.amount : null);

const monthlyFlows = (rows: LedgerRow[], months: string[]): MonthFlow[] =>
  months.map((month) => {
    const inMonth = rows.filter((row) => row.date.startsWith(month));
    const total = (keep: (row: LedgerRow) => boolean): number =>
      inMonth.filter(keep).reduce((acc, row) => acc + (myr(row) ?? 0), 0);
    return {
      month,
      income: total((row) => row.type === "sales-invoice" || row.type === "salary"),
      expenses: total((row) => EXPENSE_TYPES.has(row.type) && isDeductible(row)),
    };
  });

const hbar = (label: string, value: number, max: number, tone: string): string => {
  const width = max > 0 ? Math.max(0, Math.min(100, (Math.abs(value) / max) * 100)) : 0;
  return `<div class="hbar"><span class="hbar-label">${escapeHtml(label)}</span><span class="hbar-track"><span class="hbar-fill ${tone}" style="width:${width.toFixed(1)}%"></span></span><span class="hbar-value">${money(value)}</span></div>`;
};

const monthlyChart = (flows: MonthFlow[]): string => {
  const max = Math.max(1, ...flows.flatMap((flow) => [flow.income, flow.expenses]));
  const empty = flows.every((flow) => flow.income === 0 && flow.expenses === 0);
  if (empty) {
    return `<p class="empty">No income or expenses in the ledger for this year yet.</p>`;
  }
  const columns = flows
    .map(
      (flow) =>
        `<div class="col"><div class="bars"><span class="vbar income" style="height:${((flow.income / max) * 100).toFixed(1)}%" title="${monthLabel(flow.month)} income ${money(flow.income)}"></span><span class="vbar expense" style="height:${((flow.expenses / max) * 100).toFixed(1)}%" title="${monthLabel(flow.month)} deductible expenses ${money(flow.expenses)}"></span></div><span class="col-label">${monthLabel(flow.month, false)}</span></div>`
    )
    .join("");
  const table = flows
    .map((flow) => `<tr><td>${monthLabel(flow.month)}</td><td>${money(flow.income)}</td><td>${money(flow.expenses)}</td></tr>`)
    .join("");
  return `<div class="legend"><span class="key income"></span> Income <span class="key expense"></span> Deductible expenses</div><div class="columns">${columns}</div><details><summary>Show as a table</summary><table class="list"><thead><tr><th>Month</th><th>Income</th><th>Deductible expenses</th></tr></thead><tbody>${table}</tbody></table></details>`;
};

interface Item {
  occurrence: Occurrence;
  state: TaskState;
}

const deadlineRows = (items: Item[], today: string, showEntity: boolean): string =>
  items.length === 0
    ? `<p class="empty">Nothing due in this window.</p>`
    : `<table class="list deadlines"><tbody>${items
        .map(
          ({ occurrence, state }) =>
            `<tr><td class="when">${dayLabel(occurrence.due)}<span class="year">${occurrence.due.slice(0, 4)}</span></td>${showEntity ? `<td class="who"><span class="dot e-${slug(occurrence.entity)}"></span>${escapeHtml(occurrence.entityName)}</td>` : ""}<td>${escapeHtml(shortTitle(occurrence))}</td><td class="state">${statusTag(occurrence, state, today)}</td></tr>`
        )
        .join("")}</tbody></table>`;

const calendarGrid = (entities: Entity[], items: Item[], months: string[], today: string): string => {
  const rows = entities
    .map((entity) => {
      const cells = months
        .map((month) => {
          const inCell = items.filter((item) => item.occurrence.entity === entity.slug && item.occurrence.due.startsWith(month));
          return `<td>${inCell
            .map(
              ({ occurrence, state }) =>
                `<div class="chip ${soon(occurrence, state, today) ? "soon" : state}" title="${escapeHtml(`${occurrence.title} · ${occurrence.due} · ${STATE_META[state].label}`)}"><b>${Number(occurrence.due.slice(8))}</b> ${escapeHtml(shortTitle(occurrence))}</div>`
            )
            .join("")}</td>`;
        })
        .join("");
      return `<tr><th scope="row"><span class="dot e-${slug(entity.slug)}"></span>${escapeHtml(entity.name)}</th>${cells}</tr>`;
    })
    .join("");
  return `<div class="scroll"><table class="grid"><thead><tr><th></th>${months.map((month) => `<th>${monthLabel(month)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div><p class="note">✓ done · ● open · ◷ due within 14 days · ! overdue · ○ not a task yet (tasks are created three weeks ahead)</p>`;
};

const kindLabel = (kind: EntityKind): string => (kind === EntityKind.Company ? "Business" : "Personal");

/**
 * A title without its leading "<Entity>: " when the row already names the entity.
 */
const shortTitle = (occurrence: Occurrence): string => {
  const prefix = occurrence.entityName.split(/[\s(]/)[0];
  return occurrence.title.startsWith(`${prefix}: `) ? occurrence.title.slice(prefix.length + 2) : occurrence.title;
};

const notes = (position: Position): string => {
  const lines = [...position.missing, ...position.warnings];
  return lines.length === 0 ? "" : `<ul class="notes">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`;
};

const filing = (balance: number | null): { label: string; figure: string; caption: string } =>
  balance === null
    ? { label: "At filing", figure: "—", caption: "not priced yet" }
    : balance < 0
      ? { label: "Refund at filing", figure: money(-balance), caption: "refund expected when you file, at this pace" }
      : { label: "Top-up at filing", figure: money(balance), caption: "to pay when you file, at this pace" };

const RELIEF_ORDER: Record<ReliefStatus, number> = {
  [ReliefStatus.Unconfirmed]: 0,
  [ReliefStatus.Partial]: 1,
  [ReliefStatus.Open]: 2,
  [ReliefStatus.Full]: 3,
};

const sortedReliefs = (view: PersonalView): ReliefLine[] =>
  [...view.reliefs].sort((a, b) => RELIEF_ORDER[a.status] - RELIEF_ORDER[b.status] || b.worth - a.worth);

const percent = (rate: number | null): string => (rate === null ? "—" : `${(rate * 100).toFixed(1)}%`);

const personalCard = (entity: Entity, position: Position, view: PersonalView, next: Item | undefined): string => {
  const outcome = filing(view.filingBalance);
  const best = sortedReliefs(view).find((line) => line.status !== ReliefStatus.Full && line.worth > 0);
  return `<label for="tab-${slug(entity.slug)}" class="card entity e-${slug(entity.slug)}"><div class="card-head"><span class="dot e-${slug(entity.slug)}"></span><span class="card-name">${escapeHtml(entity.name)}</span>${entity.name === kindLabel(entity.kind) ? "" : `<span class="kind">${kindLabel(entity.kind)}</span>`}</div><div class="card-figure">${outcome.figure}</div><div class="card-caption">${outcome.caption}</div><dl><dt>Withheld from salary</dt><dd>${position.known ? money(view.withheld) : "—"}</dd><dt>Tax on income not withheld</dt><dd>${position.known ? money(view.taxOnUnwithheld) : "—"}</dd><dt>Best unused relief</dt><dd>${best ? `${escapeHtml(best.title.split(":")[0])} · up to ${money(best.worth)}` : "—"}</dd><dt>Next deadline</dt><dd>${next ? `${dayLabel(next.occurrence.due)} · ${escapeHtml(shortTitle(next.occurrence))}` : "—"}</dd></dl>${[...position.missing, ...position.warnings].map((line) => `<div class="card-flag">${escapeHtml(line)}</div>`).join("")}</label>`;
};

const entityCard = (entity: Entity, position: Position, next: Item | undefined): string =>
  position.personal !== null
    ? personalCard(entity, position, position.personal, next)
    : `<label for="tab-${slug(entity.slug)}" class="card entity e-${slug(entity.slug)}"><div class="card-head"><span class="dot e-${slug(entity.slug)}"></span><span class="card-name">${escapeHtml(entity.name)}</span><span class="kind">${kindLabel(entity.kind)}</span></div><div class="card-figure">${moneyOrDash(position.owedNow)}</div><div class="card-caption">${position.known ? `owed now for YA ${position.ya}` : "not priced yet"}${position.aheadBy > 0 ? ` · ahead by ${money(position.aheadBy)}` : ""}</div><dl><dt>Year projection</dt><dd>${moneyOrDash(position.projectedTax)}</dd><dt>Per month</dt><dd>${moneyOrDash(position.monthlyTax)}</dd><dt>Books through</dt><dd>${position.coverage ? monthLabel(position.coverage) : "—"}</dd><dt>Next deadline</dt><dd>${next ? `${dayLabel(next.occurrence.due)} · ${escapeHtml(shortTitle(next.occurrence))}` : "—"}</dd></dl>${[...position.missing, ...position.warnings].map((line) => `<div class="card-flag">${escapeHtml(line)}</div>`).join("")}</label>`;

const sumKnown = (list: Position[], pick: (position: Position) => number | null): number | null => {
  const known = list.map(pick).filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((acc, value) => acc + value, 0);
};

const overviewPanel = (entities: Entity[], list: Position[], items: Item[], months: string[], today: string): string => {
  const businesses = list.filter((position) => position.kind === EntityKind.Company);
  const personal = list.filter((position) => position.kind === EntityKind.Individual);
  const total = sumKnown(list, (position) => position.owedNow);
  const unknown = list.filter((position) => !position.known).length;
  const monthly = sumKnown(list, (position) => position.monthlyTax);
  const upcoming = items.filter((item) => item.occurrence.due >= today && item.state !== TaskState.Done && item.state !== TaskState.Skipped);
  const overdue = items.filter((item) => item.state === TaskState.Overdue);
  const nextFor = (entity: Entity): Item | undefined => upcoming.find((item) => item.occurrence.entity === entity.slug);
  const window = [...overdue, ...upcoming.filter((item) => item.occurrence.due <= addDays(today, 60))];
  const heroCaption =
    total === null
      ? "Not enough in the books yet to price it. Each card below says what's missing."
      : unknown > 0
        ? `Across the entities with books this year. ${unknown} more ${unknown === 1 ? "is" : "are"} not priced yet.`
        : "If every year ended today, this is what you'd owe after what's already paid.";
  return `<section class="panel" id="panel-overview">
<div class="hero">
  <div class="hero-main"><div class="eyebrow">Tax you owe right now</div><div class="hero-figure">${moneyOrDash(total)}</div><p class="hero-caption">${heroCaption}</p></div>
  <div class="hero-side">
    <div class="split"><div><div class="eyebrow">Business</div><div class="split-figure">${moneyOrDash(sumKnown(businesses, (position) => position.owedNow))}</div></div><div><div class="eyebrow">Personal, beyond PCB</div><div class="split-figure">${moneyOrDash(sumKnown(personal, (position) => position.owedNow))}</div></div></div>
    <div class="budget"><div class="eyebrow">Set aside every month</div><div class="split-figure">${moneyOrDash(monthly)}</div><p>of what comes in is tax this year, at the current pace.</p></div>
  </div>
</div>
<div class="cards">${orderEntities(entities)
    .map((entity) => {
      const position = list.find((item) => item.entity === entity.slug);
      return position === undefined ? "" : entityCard(entity, position, nextFor(entity));
    })
    .join("")}</div>
<section class="box"><h2>Next 60 days</h2>${deadlineRows(window, today, true)}</section>
<section class="box"><h2>Twelve months</h2>${calendarGrid(orderEntities(entities), items, months, today)}</section>
</section>`;
};

const reliefTable = (view: PersonalView): string =>
  `<table class="list reliefs"><tbody>${sortedReliefs(view)
    .map((line) => {
      const width = line.cap > 0 ? Math.min(100, (line.claimed / line.cap) * 100) : 0;
      const note =
        line.status === ReliefStatus.Full
          ? `<span class="tag done"><span aria-hidden="true">✓</span> Claimed</span>`
          : line.status === ReliefStatus.Unconfirmed
            ? `<span class="tag soon"><span aria-hidden="true">?</span> Confirm · up to ${money(line.worth)}</span>`
            : `<span class="tag upcoming">${line.worth > 0 ? `up to ${money(line.worth)} off` : "open"}</span>`;
      return `<tr><td class="relief-name">${escapeHtml(line.title)}</td><td class="relief-bar"><span class="hbar-track"><span class="hbar-fill ink" style="width:${width.toFixed(1)}%"></span></span><span class="relief-amount">${money(line.claimed)} of ${money(line.cap)}</span></td><td class="state">${note}</td></tr>`;
    })
    .join("")}</tbody></table><p class="note">"Up to" is the tax a relief would save if you claimed all of it, at this year's projected income. Record what you spend as relief rows (or drop the receipts in the inbox) and it counts.</p>`;

const personalPanel = (entity: Entity, position: Position, view: PersonalView, items: Item[], rows: LedgerRow[], today: string): string => {
  const periodMonths = monthKeys(position.period.start.slice(0, 7), position.periodMonths);
  const flows = monthlyFlows(
    rows.filter((row) => row.date >= position.period.start && row.date <= position.period.end),
    periodMonths
  );
  const outcome = filing(view.filingBalance);
  const incomeMax = Math.max(position.employment, position.income, view.reliefTotal, 1);
  const taxMax = Math.max(position.taxSoFar, view.withheld, 1);
  const upcoming = items.filter(
    (item) => item.occurrence.entity === entity.slug && (item.state === TaskState.Overdue || (item.occurrence.due >= today && item.state !== TaskState.Done))
  );
  return `<section class="panel" id="panel-${slug(entity.slug)}">
<div class="entity-head"><span class="dot big e-${slug(entity.slug)}"></span><div><h2>${escapeHtml(entity.name)}</h2><p class="sub">YA ${position.ya} · ${dayLabel(position.period.start)} ${position.period.start.slice(0, 4)} – ${dayLabel(position.period.end)} ${position.period.end.slice(0, 4)} · income recorded through ${position.coverage ? monthLabel(position.coverage) : "—"}</p></div></div>
<div class="tiles">
  <div class="tile lead"><div class="eyebrow">${outcome.label}</div><div class="tile-figure">${outcome.figure}</div><div class="tile-note">${outcome.caption}</div></div>
  <div class="tile"><div class="eyebrow">Withheld from salary</div><div class="tile-figure">${position.known ? money(view.withheld) : "—"}</div><div class="tile-note">PCB so far</div></div>
  <div class="tile"><div class="eyebrow">Income not withheld</div><div class="tile-figure">${position.known ? money(view.unwithheldIncome) : "—"}</div><div class="tile-note">consulting and other business income</div></div>
  <div class="tile"><div class="eyebrow">Set aside from it</div><div class="tile-figure">${position.known ? money(view.taxOnUnwithheld) : "—"}</div><div class="tile-note">the tax that income adds</div></div>
  <div class="tile"><div class="eyebrow">Effective rate</div><div class="tile-figure">${percent(view.effectiveRate)}</div><div class="tile-note">of the year's income</div></div>
</div>
${notes(position)}
<div class="two">
  <section class="box"><h2>How the number is built</h2>${
    position.known
      ? `<div class="build"><h3>Income so far</h3>${hbar("Employment income", position.employment, incomeMax, "ink")}${hbar("Business income", position.income, incomeMax, "ink")}${hbar("Reliefs", view.reliefTotal, incomeMax, "muted")}<h3>Tax</h3>${hbar("Tax on it so far", position.taxSoFar, taxMax, "ink")}${hbar("Withheld from salary", view.withheld, taxMax, "muted")}${hbar(position.aheadBy > 0 ? "Over-withheld so far" : "Not yet covered", position.aheadBy > 0 ? position.aheadBy : (position.owedNow ?? 0), taxMax, `e-${slug(entity.slug)}`)}</div>`
      : `<p class="empty">Priced once this year's salary and invoices are recorded.</p>`
  }</section>
  <section class="box"><h2>Month by month</h2>${monthlyChart(flows)}</section>
</div>
<section class="box"><h2>Deadlines</h2>${deadlineRows(upcoming.slice(0, 8), today, false)}</section>
<section class="box"><h2>Reliefs this year</h2>${reliefTable(view)}</section>
</section>`;
};

const entityPanel = (entity: Entity, position: Position, items: Item[], rows: LedgerRow[], closed: string | null, today: string): string => {
  if (position.personal !== null) {
    return personalPanel(entity, position, position.personal, items, rows, today);
  }
  const periodMonths = monthKeys(position.period.start.slice(0, 7), position.periodMonths);
  const flows = monthlyFlows(
    rows.filter((row) => row.date >= position.period.start && row.date <= position.period.end),
    periodMonths
  );
  const profitMax = Math.max(position.carriedIn, position.income, position.employment, position.expenses, Math.abs(position.profit), 1);
  const carried =
    position.carriedInTo === null
      ? ""
      : hbar(`Carried in to ${dayLabel(position.carriedInTo)}`, position.carriedIn, profitMax, "muted");
  const taxMax = Math.max(position.taxSoFar, position.paid, position.owedNow ?? 0, 1);
  const mine = items.filter((item) => item.occurrence.entity === entity.slug);
  const upcoming = mine.filter((item) => item.state === TaskState.Overdue || (item.occurrence.due >= today && item.state !== TaskState.Done));
  const estimate =
    entity.kind === EntityKind.Company
      ? `<section class="box"><h2>Tax estimate</h2><dl class="facts"><dt>On file for YA ${position.ya}</dt><dd>${moneyOrDash(position.estimateOnFile)}</dd><dt>Projected tax</dt><dd>${moneyOrDash(position.projectedTax)}</dd><dt>Penalty if left as is</dt><dd class="${position.underestimationPenalty ? "warn" : ""}">${position.underestimationPenalty ? money(position.underestimationPenalty) : "—"}</dd></dl></section>`
      : "";
  const close =
    entity.close === "monthly"
      ? `<section class="box"><h2>Monthly close</h2><p class="big">${closed ? `Closed through ${monthLabel(closed)}` : "No month closed yet"}</p></section>`
      : "";
  return `<section class="panel" id="panel-${slug(entity.slug)}">
<div class="entity-head"><span class="dot big e-${slug(entity.slug)}"></span><div><h2>${escapeHtml(entity.name)}</h2><p class="sub">${kindLabel(entity.kind)} · YA ${position.ya} · ${dayLabel(position.period.start)} ${position.period.start.slice(0, 4)} – ${dayLabel(position.period.end)} ${position.period.end.slice(0, 4)} · books through ${position.coverage ? monthLabel(position.coverage) : "—"}</p></div></div>
<div class="tiles">
  <div class="tile lead"><div class="eyebrow">Owed now</div><div class="tile-figure">${moneyOrDash(position.owedNow)}</div>${position.aheadBy > 0 ? `<div class="tile-note">ahead by ${money(position.aheadBy)}</div>` : ""}</div>
  <div class="tile"><div class="eyebrow">Tax so far</div><div class="tile-figure">${position.known ? money(position.taxSoFar) : "—"}</div></div>
  <div class="tile"><div class="eyebrow">Already paid</div><div class="tile-figure">${position.known ? money(position.paid) : "—"}</div></div>
  <div class="tile"><div class="eyebrow">Year projection</div><div class="tile-figure">${moneyOrDash(position.projectedTax)}</div></div>
  <div class="tile"><div class="eyebrow">Per month</div><div class="tile-figure">${moneyOrDash(position.monthlyTax)}</div></div>
</div>
${notes(position)}
<div class="two">
  <section class="box"><h2>How the number is built</h2>${
    position.known
      ? `<div class="build"><h3>Profit so far</h3>${carried}${hbar(entity.kind === EntityKind.Company ? "Income" : "Business income", position.income, profitMax, "ink")}${entity.kind === EntityKind.Individual ? hbar("Employment income", position.employment, profitMax, "ink") : ""}${hbar("Deductible expenses", position.expenses, profitMax, "muted")}${hbar(entity.kind === EntityKind.Company ? "Profit" : "Total income", position.profit, profitMax, `e-${slug(entity.slug)}`)}<h3>Tax</h3>${hbar("Tax so far", position.taxSoFar, taxMax, "ink")}${hbar("Already paid", position.paid, taxMax, "muted")}${hbar("Owed now", position.owedNow ?? 0, taxMax, `e-${slug(entity.slug)}`)}</div>`
      : `<p class="empty">Priced once the ledger has this year's rows or the accountant's opening figure.</p>`
  }</section>
  <section class="box"><h2>Month by month</h2>${monthlyChart(flows)}${position.carriedInTo === null ? "" : `<p class="note">Months to ${dayLabel(position.carriedInTo)} arrive as one figure from the accountant's management accounts, so they have no bars.</p>`}</section>
</div>
<div class="two">
  <section class="box"><h2>Deadlines</h2>${deadlineRows(upcoming.slice(0, 12), today, false)}</section>
  <div class="stack">${estimate}${close}</div>
</div>
</section>`;
};

const lastClosed = (taxDir: string, entitySlug: string): string | null => {
  const dir = join(taxDir, "closes", entitySlug);
  if (!existsSync(dir)) {
    return null;
  }
  return (
    readdirSync(dir)
      .filter((file) => /^\d{4}-\d{2}\.md$/.test(file))
      .map((file) => basename(file, ".md"))
      .sort()
      .at(-1) ?? null
  );
};

const STYLE = `
:root{color-scheme:light dark;--page:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink-2:#52514e;--muted:#898781;--line:#e1e0d9;--ring:rgba(11,11,11,.10);
--e1:#2a78d6;--e2:#eb6834;--e3:#1baf7a;--good:#0ca30c;--warning:#fab219;--serious:#ec835a;--critical:#d03b3b;--bar-muted:#c3c2b7;--tab:#ecebe6}
@media (prefers-color-scheme:dark){:root{--page:#0d0d0d;--surface:#1a1a19;--ink:#ffffff;--ink-2:#c3c2b7;--muted:#898781;--line:#2c2c2a;--ring:rgba(255,255,255,.10);
--e1:#3987e5;--e2:#d95926;--e3:#199e70;--bar-muted:#383835;--tab:#232321}}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1280px;margin:0 auto;padding:28px 28px 48px}
header.top{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:18px}
header.top h1{font-size:22px;margin:0;letter-spacing:-.01em}
header.top p{margin:0;color:var(--muted);font-size:12.5px}
input.tab{position:absolute;opacity:0;pointer-events:none}
nav.tabs{display:flex;gap:4px;padding:4px;background:var(--tab);border-radius:12px;width:max-content;max-width:100%;overflow-x:auto;margin-bottom:22px}
nav.tabs label{padding:7px 14px;border-radius:9px;cursor:pointer;color:var(--ink-2);font-weight:500;white-space:nowrap;display:flex;align-items:center;gap:8px}
nav.tabs label:hover{color:var(--ink)}
.panel{display:none}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--muted);flex:none}
.dot.big{width:14px;height:14px}
.box,.card,.hero,.tile{background:var(--surface);border:1px solid var(--ring);border-radius:14px}
.hero{display:grid;grid-template-columns:1.35fr 1fr;gap:0;overflow:hidden;margin-bottom:16px}
.hero-main{padding:26px 28px}
.hero-side{border-left:1px solid var(--line);display:grid;grid-template-rows:auto 1fr}
.split{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--line)}
.split>div{padding:18px 22px}.split>div+div{border-left:1px solid var(--line)}
.budget{padding:18px 22px}.budget p{margin:4px 0 0;color:var(--ink-2);font-size:13px}
.eyebrow{font-size:11.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600}
.hero-figure{font-size:56px;font-weight:650;letter-spacing:-.02em;line-height:1.1;margin:6px 0 8px}
.hero-caption{margin:0;color:var(--ink-2);max-width:46ch}
.split-figure{font-size:24px;font-weight:600;margin-top:4px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-bottom:16px}
.card{display:block;padding:18px 20px;cursor:pointer;border-top:3px solid var(--muted);transition:border-color .15s}
.card:hover{border-color:var(--ink-2)}
.card-head{display:flex;align-items:center;gap:8px}
.card-name{font-weight:600}
.kind{margin-left:auto;font-size:11px;color:var(--ink-2);border:1px solid var(--ring);border-radius:999px;padding:1px 8px}
.card-figure{font-size:30px;font-weight:650;margin:10px 0 0;letter-spacing:-.01em}
.card-caption{color:var(--muted);font-size:12.5px;margin-bottom:12px}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0;font-size:13px}
dt{color:var(--muted)}dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
.card-flag{margin-top:10px;font-size:12px;color:var(--ink-2);border-top:1px dashed var(--line);padding-top:8px}.card-flag+.card-flag{margin-top:4px;border-top:0;padding-top:0}
.panel>.box{margin-bottom:14px}
.two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:14px;margin-bottom:14px}
.stack{display:grid;gap:14px;align-content:start}
.box{padding:18px 20px;min-width:0}
.box h2{font-size:14px;margin:0 0 12px}
.box h3{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:14px 0 8px}
.box h3:first-child{margin-top:0}
.list{width:100%;border-collapse:collapse;font-size:13px}
.list td,.list th{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.list thead th{color:var(--muted);font-weight:600}
.deadlines .when{white-space:nowrap;font-weight:600;font-variant-numeric:tabular-nums;width:72px}
.deadlines .year{display:block;color:var(--muted);font-weight:400;font-size:11px}
.deadlines .who{white-space:nowrap;color:var(--ink-2)}.deadlines .who .dot{margin-right:6px}
.deadlines .state{text-align:right;white-space:nowrap}
.tag{font-size:11.5px;padding:2px 9px;border-radius:999px;border:1px solid var(--ring);color:var(--ink-2);white-space:nowrap}
.tag.done{color:var(--good);border-color:currentColor}.tag.overdue{color:var(--critical);border-color:currentColor}
.tag.soon{color:var(--ink);border-color:var(--warning);background:color-mix(in srgb,var(--warning) 18%,transparent)}
.tag.upcoming,.tag.skipped{color:var(--muted)}
.scroll{overflow-x:auto}
.grid{border-collapse:separate;border-spacing:0;width:100%;font-size:11.5px}
.grid th,.grid td{border-bottom:1px solid var(--line);padding:6px 5px;vertical-align:top;min-width:78px}
.grid thead th{color:var(--muted);font-weight:600;text-align:left;white-space:nowrap}
.grid tbody th{text-align:left;white-space:nowrap;font-weight:600;padding-right:10px}.grid tbody th .dot{margin-right:6px}
.chip{border-left:3px solid var(--line);padding:2px 5px;margin:0 0 4px;border-radius:3px;background:color-mix(in srgb,var(--ink) 4%,transparent);line-height:1.3}
.chip.done{border-color:var(--good);opacity:.7;text-decoration:line-through}
.chip.open{border-color:var(--ink-2)}.chip.soon{border-color:var(--warning)}
.chip.overdue{border-color:var(--critical);background:color-mix(in srgb,var(--critical) 12%,transparent)}
.chip.upcoming{border-color:var(--line);color:var(--ink-2)}.chip.skipped{opacity:.5}
.note{color:var(--muted);font-size:11.5px;margin:10px 0 0}
.empty{color:var(--muted);margin:0}
.entity-head{display:flex;align-items:center;gap:14px;margin:4px 0 16px}
.entity-head h2{margin:0;font-size:22px}.entity-head .sub{margin:2px 0 0;color:var(--muted);font-size:13px}
.tiles{display:grid;grid-template-columns:1.4fr repeat(4,1fr);gap:12px;margin-bottom:14px}
.tile{padding:16px 18px}.tile.lead{border-top:3px solid var(--muted)}
.tile-figure{font-size:24px;font-weight:600;margin-top:6px}.tile.lead .tile-figure{font-size:34px}
.tile-note{color:var(--muted);font-size:12px}
.notes{margin:0 0 14px;padding:12px 16px 12px 34px;border-radius:12px;background:color-mix(in srgb,var(--warning) 12%,transparent);border:1px solid color-mix(in srgb,var(--warning) 45%,transparent);font-size:13px}
.notes li+li{margin-top:4px}
.hbar{display:grid;grid-template-columns:150px 1fr 110px;align-items:center;gap:10px;margin:6px 0;font-size:13px}
.hbar-label{color:var(--ink-2)}.hbar-value{text-align:right;font-variant-numeric:tabular-nums}
.hbar-track{height:10px;border-radius:5px;background:color-mix(in srgb,var(--ink) 6%,transparent);overflow:hidden}
.hbar-fill{display:block;height:100%;border-radius:0 5px 5px 0}.hbar-fill.ink{background:var(--ink-2)}.hbar-fill.muted{background:var(--bar-muted)}
.legend{display:flex;gap:14px;align-items:center;font-size:12px;color:var(--ink-2);margin-bottom:8px}
.key{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:-8px}
.columns{display:grid;grid-template-columns:repeat(12,1fr);gap:6px;height:160px;align-items:end}
.col{display:flex;flex-direction:column;align-items:center;height:100%}
.bars{flex:1;display:flex;align-items:flex-end;gap:2px;width:100%;justify-content:center;border-bottom:1px solid var(--line)}
.vbar{width:40%;max-width:14px;border-radius:4px 4px 0 0;min-height:0}
.vbar.expense,.key.expense{background:var(--bar-muted)}
.col-label{font-size:11px;color:var(--muted);margin-top:4px}
details{margin-top:10px;font-size:12.5px}summary{cursor:pointer;color:var(--ink-2)}
.reliefs td{vertical-align:middle}.relief-name{width:42%}.relief-bar{width:34%}.relief-bar .hbar-track{display:block;margin-bottom:3px}.relief-amount{font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.facts{font-size:13.5px}.warn{color:var(--critical);font-weight:600}
.big{font-size:18px;font-weight:600;margin:0}
footer{color:var(--muted);font-size:12px;margin-top:24px}
@media (max-width:900px){.hero,.two{grid-template-columns:1fr}.hero-side{border-left:0;border-top:1px solid var(--line)}.tiles{grid-template-columns:1fr 1fr}}
`;

const entityStyles = (entities: Entity[]): string =>
  entities
    .map((entity, i) => {
      const colour = i < SLOTS ? `var(--e${i + 1})` : "var(--muted)";
      const id = slug(entity.slug);
      return `.e-${id}.dot,.dot.e-${id}{background:${colour}}.card.e-${id}{border-top-color:${colour}}.hbar-fill.e-${id}{background:${colour}}#panel-${id} .tile.lead{border-top-color:${colour}}#panel-${id} .vbar.income,#panel-${id} .key.income{background:${colour}}`;
    })
    .join("\n");

const tabStyles = (ids: string[]): string =>
  ids
    .map(
      (id) =>
        `#tab-${id}:checked~.panels #panel-${id}{display:block}#tab-${id}:checked~nav.tabs label[for="tab-${id}"]{background:var(--surface);color:var(--ink);box-shadow:0 1px 2px var(--ring)}`
    )
    .join("\n");

/**
 * The whole dashboard page for the tax project at `taxDir`, as of `today`.
 */
export const renderDashboard = (taxDir: string, today: string, countriesDir: string = COUNTRIES_DIR): string => {
  const entities = orderEntities(loadEntities(taxDir));
  const existing: ExistingTask[] = loadExisting(taxDir);
  const list = positions(taxDir, countriesDir, entities, today);
  const months = monthKeys(today.slice(0, 7), 12);
  const windowEnd = lastDay(months[11]);
  const oneOffs = loadOneOffs(taxDir, entities);
  const toItem = (occurrence: Occurrence): Item => ({ occurrence, state: stateOf(occurrence, existing, today) });
  const current = [
    ...entities.flatMap((entity) => occurrences(entity, `${months[0]}-01`, windowEnd)),
    ...oneOffs.filter((item) => item.due >= `${months[0]}-01` && item.due <= windowEnd),
  ].map(toItem);
  const pastDue = [
    ...entities.flatMap((entity) => occurrences(entity, addDays(today, -366), addDays(`${months[0]}-01`, -1))),
    ...oneOffs.filter((item) => item.due < `${months[0]}-01`),
  ]
    .map(toItem)
    .filter((item) => item.state === TaskState.Overdue);
  const items = [...pastDue, ...current].sort(
    (a, b) => a.occurrence.due.localeCompare(b.occurrence.due) || a.occurrence.label.localeCompare(b.occurrence.label)
  );
  const ids = ["overview", ...entities.map((entity) => slug(entity.slug))];
  const radios = ids.map((id, i) => `<input class="tab" type="radio" name="tab" id="tab-${id}"${i === 0 ? " checked" : ""}>`).join("");
  const labels = [
    `<label for="tab-overview">Overview</label>`,
    ...entities.map((entity) => `<label for="tab-${slug(entity.slug)}"><span class="dot e-${slug(entity.slug)}"></span>${escapeHtml(entity.name)}</label>`),
  ].join("");
  const panels = [
    overviewPanel(entities, list, items, months, today),
    ...entities.map((entity) => {
      const position = list.find((item) => item.entity === entity.slug);
      return position === undefined
        ? ""
        : entityPanel(entity, position, items, loadLedger(taxDir, entity.slug), lastClosed(taxDir, entity.slug), today);
    }),
  ].join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tax &amp; Books</title>
<style>${STYLE}
${entityStyles(entities)}
${tabStyles(ids)}
</style>
</head>
<body>
<div class="wrap">
<header class="top"><h1>Tax &amp; Books</h1><p>As of ${today} · generated by the tax skill, don't edit by hand</p></header>
${radios}
<nav class="tabs">${labels}</nav>
<main class="panels">
${panels}
</main>
<footer>Figures are Kevin's running estimate from the ledger and the published rates, for planning. Your tax agent's computation is the one that's filed.</footer>
</div>
</body>
</html>
`;
};
