import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addDays,
  type Entity,
  loadExisting,
  occurrences,
  parseEntity,
  pendingCloses,
  plan,
  stateOf,
  TaskState,
} from "./calendar";
import { renderDashboard, shortName } from "./dashboard";

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
  startedOn: null,
  bookedThrough: null,
  accounts: [],
  obligations: [
    { id: "cp204", title: "CP204 estimate", period: { months: 12, anchor: "fye" }, due: { from: "start", days: -31 } },
    { id: "cp204a-11th", title: "CP204A 11th month", period: { months: 12, anchor: "fye" }, due: { from: "start", months: 10, day: "last" } },
    { id: "form-c", title: "Form C", period: { months: 12, anchor: "fye" }, due: { from: "end", months: 7, day: "last" } },
    { id: "instalment", title: "CP204 instalment", period: { months: 1, anchor: 1 }, due: { from: "end", months: 1, day: 15 } },
    { id: "sst-02", title: "SST-02", period: { months: 2, anchor: 2 }, due: { from: "end", months: 1, day: "last" } },
    { id: "form-ea", title: "Form EA", period: { months: 12, anchor: 12 }, due: { from: "end", months: 2, day: 31 } },
  ],
};

const dues = (id: string, from: string, to: string): string[] =>
  occurrences(acme, from, to)
    .filter((item) => item.obligation === id)
    .map((item) => item.due);

const dirs: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "tax-calendar-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const write = (root: string, file: string, body: string): void => {
  mkdirSync(join(root, file, ".."), { recursive: true });
  writeFileSync(join(root, file), body);
};

const task = (id: string, status: string, labels: string[]): string =>
  `---\nschema: 1\nid: ${id}\ntitle: t\ntype: task\nstatus: ${status}\npriority: P1\nproject: tax\nassignee: [kevin]\nlabels: [${labels
    .map((label) => `"${label}"`)
    .join(", ")}]\ncreated: 2026-01-01\nupdated: 2026-01-01\ndue:\ndepends_on: []\nblocked_by:\nparent:\nclosed:\n---\n\n## Description\n\nx\n`;

const profile = `---
name: Acme Sdn. Bhd.
kind: company
fye: 12-31
close: monthly
---

# Acme

## Obligations

\`\`\`yaml
- { id: form-c, title: Form C, period: { months: 12, anchor: fye }, due: { from: end, months: 7, day: last }, from: "2026-07" }
- { id: instalment, title: CP204 instalment, period: { months: 1, anchor: 1 }, due: { from: end, months: 1, day: 15 }, lead: 10, from: "2026-07" }
\`\`\`

## Notes

Anything after the block is ignored by the engine.
`;

describe("occurrences", () => {
  test("the next YA's estimate is due 1 Dec, 31 days before a 1 Jan basis period", () => {
    expect(dues("cp204", "2026-11-01", "2026-12-31")).toEqual(["2026-12-01"]);
  });

  test("the 11th-month revision lands on the last day of the basis period's 11th month", () => {
    expect(dues("cp204a-11th", "2026-01-01", "2026-12-31")).toEqual(["2026-11-30"]);
  });

  test("the annual return is due 7 months after the financial year end", () => {
    expect(dues("form-c", "2027-01-01", "2027-12-31")).toEqual(["2027-07-31"]);
  });

  test("monthly instalments fall on the 15th of the following month", () => {
    expect(dues("instalment", "2026-10-01", "2026-12-31")).toEqual(["2026-10-15", "2026-11-15", "2026-12-15"]);
  });

  test("a two-month period follows its anchor and is due at the end of the following month", () => {
    expect(dues("sst-02", "2026-01-01", "2026-12-31")).toEqual([
      "2026-01-31",
      "2026-03-31",
      "2026-05-31",
      "2026-07-31",
      "2026-09-30",
      "2026-11-30",
    ]);
  });

  test("a fixed day clamps to the month's last day", () => {
    expect(dues("form-ea", "2027-01-01", "2028-12-31")).toEqual(["2027-02-28", "2028-02-29"]);
  });

  test("the label keys the period by its end month", () => {
    const [first] = occurrences(acme, "2026-11-30", "2026-11-30").filter((item) => item.obligation === "cp204a-11th");
    expect(first.label).toBe("obl:acme:cp204a-11th:2026-12");
  });

  test("from and until bound the periods an obligation covers", () => {
    const bounded: Entity = {
      ...acme,
      obligations: [{ ...acme.obligations[3], from: "2026-11", until: "2026-12" }],
    };
    expect(occurrences(bounded, "2026-01-01", "2027-12-31").map((item) => item.due)).toEqual(["2026-12-15", "2027-01-15"]);
  });
});

describe("parseEntity", () => {
  test("reads obligations from YAML frontmatter", () => {
    const entity = parseEntity("acme", profile);
    expect(entity.name).toBe("Acme Sdn. Bhd.");
    expect(entity.close).toBe("monthly");
    expect(entity.obligations.map((item) => item.id)).toEqual(["form-c", "instalment"]);
  });

  test("keeps frontmatter flat: obligations there are refused with a pointer to the body block", () => {
    const nested = "---\nname: Acme\nobligations:\n  - { id: form-c }\n---\n";
    expect(() => parseEntity("acme", nested)).toThrow(/## Obligations/);
  });

  test("a profile with no obligations section has none", () => {
    expect(parseEntity("acme", "---\nname: Acme\n---\n\n# Acme\n").obligations).toEqual([]);
  });

  test("names the broken obligation instead of dropping it", () => {
    const broken = profile.replace("due: { from: end, months: 7, day: last }", "due: { months: 7 }");
    expect(() => parseEntity("acme", broken)).toThrow(/form-c is malformed/);
  });
});

test("parseEntity refuses an unquoted from or until month instead of dropping every deadline", () => {
  const unquoted = profile.replace('from: "2026-07" }', "from: 2026-07 }");
  expect(unquoted).not.toBe(profile);
  expect(() => parseEntity("acme", unquoted)).toThrow("form-c");
  expect(parseEntity("acme", profile).obligations).toHaveLength(2);
});

describe("plan", () => {
  test("creates only what is inside its lead window and not already a task", () => {
    const dir = scratch();
    write(dir, "entities/acme.md", profile);
    const result = plan(dir, "2026-10-08");
    expect(result.missing.map((item) => item.label)).toEqual([
      "obl:acme:instalment:2026-07",
      "obl:acme:instalment:2026-08",
      "obl:acme:instalment:2026-09",
    ]);
  });

  test("never recreates an obligation that is open, done and archived, or cancelled", () => {
    const dir = scratch();
    write(dir, "entities/acme.md", profile);
    write(dir, "tasks/ta-001-a.md", task("ta-001", "open", ["tax", "obl:acme:instalment:2026-07"]));
    write(dir, "tasks/archive/ta-002-b.md", task("ta-002", "done", ["tax", "obl:acme:instalment:2026-08"]));
    write(dir, "tasks/ta-003-c.md", task("ta-003", "cancelled", ["obl:acme:instalment:2026-09"]));
    expect(plan(dir, "2026-10-08").missing).toEqual([]);
    expect(loadExisting(dir).map((item) => item.id).sort()).toEqual(["ta-001", "ta-002", "ta-003"]);
  });

  test("a close is pending when last month's close record is missing", () => {
    const dir = scratch();
    write(dir, "entities/acme.md", profile);
    const entities = [parseEntity("acme", profile)];
    expect(pendingCloses(dir, entities, "2026-10-08")).toEqual([{ entity: "acme", month: "2026-09" }]);
    write(dir, "closes/acme/2026-09.md", "# closed\n");
    expect(pendingCloses(dir, entities, "2026-10-08")).toEqual([]);
  });
});

describe("stateOf", () => {
  const [occurrence] = occurrences(acme, "2026-10-15", "2026-10-15");
  test("no task yet is upcoming before the due date and overdue after", () => {
    expect(stateOf(occurrence, [], "2026-10-01")).toBe(TaskState.Upcoming);
    expect(stateOf(occurrence, [], "2026-10-16")).toBe(TaskState.Overdue);
  });
  test("a task's status decides once it exists", () => {
    const existing = (status: string) => [{ id: "ta-001", label: occurrence.label, status }];
    expect(stateOf(occurrence, existing("done"), "2026-10-20")).toBe(TaskState.Done);
    expect(stateOf(occurrence, existing("cancelled"), "2026-10-20")).toBe(TaskState.Skipped);
    expect(stateOf(occurrence, existing("open"), "2026-10-01")).toBe(TaskState.Open);
    expect(stateOf(occurrence, existing("open"), "2026-10-20")).toBe(TaskState.Overdue);
  });
});

test("shortName drops a trailing legal suffix and leaves other names alone", () => {
  expect(shortName("Acme Sdn. Bhd.")).toBe("Acme");
  expect(shortName("Acme Sdn Bhd")).toBe("Acme");
  expect(shortName("Acme Pte. Ltd.")).toBe("Acme");
  expect(shortName("Acme, Inc.")).toBe("Acme");
  expect(shortName("Personal")).toBe("Personal");
  expect(shortName("Bhd.")).toBe("Bhd.");
});

describe("renderDashboard", () => {
  test("is stable for unchanged input and loads nothing external", () => {
    const dir = scratch();
    write(dir, "entities/acme.md", profile);
    const first = renderDashboard(dir, "2026-10-08");
    expect(renderDashboard(dir, "2026-10-08")).toBe(first);
    expect(first).not.toMatch(/<script|<link|https?:\/\//);
    expect(first).toContain("Acme Sdn. Bhd.");
  });

  test("lists dated one-off tax tasks beside the obligations, and leaves finished ones out", () => {
    const dir = scratch();
    write(dir, "entities/acme.md", profile);
    write(dir, "tasks/ta-010-a.md", task("ta-010", "open", ["tax", "entity:acme"]).replace("due:\n", "due: 2026-10-20\n"));
    write(dir, "tasks/ta-011-b.md", task("ta-011", "done", ["tax"]).replace("due:\n", "due: 2026-10-21\n"));
    const html = renderDashboard(dir, "2026-10-08");
    const soon = html.slice(html.indexOf("Next 60 days"), html.indexOf("Twelve months"));
    expect(soon).toContain("20 Oct");
    expect(soon).not.toContain("21 Oct");
  });

  test("prices the year from the ledger and shows the estimate on file against it", () => {
    const dir = scratch();
    write(dir, "entities/acme.md", profile.replace("kind: company", "kind: company\ncountry: my"));
    write(dir, "estimates/acme/2026.md", "---\nya: 2026\nfiled: 0\nupdated: 2026-11-20\n---\n");
    write(dir, "ledger/acme/2026.csv", "date,type,counterparty,country,currency,amount,tax,reference,category,file,flags,notes\n2026-10-15,opening,Acme accountant,MY,MYR,100000,0,management accounts to Oct,,,,\n");
    const html = renderDashboard(dir, "2026-11-21");
    expect(html).toContain("RM 24,000");
    expect(html).toContain("Penalty if left as is");
  });

  test("an entity with no books this year shows a dash, never RM 0", () => {
    const dir = scratch();
    write(dir, "entities/acme.md", profile);
    const html = renderDashboard(dir, "2026-10-08");
    expect(html).toContain('<div class="hero-figure">—</div>');
    expect(html).not.toContain('<div class="hero-figure">RM 0</div>');
  });

  test("an unpriced personal year asks to confirm a household relief without pricing it at RM 0", () => {
    const dir = scratch();
    write(dir, "entities/ada.md", "---\nname: Personal\nkind: individual\ncountry: my\nfye: 12-31\nclose: none\n---\n\n## Obligations\n\n```yaml\n[]\n```\n");
    const html = renderDashboard(dir, "2026-10-08");
    expect(html).toContain("Confirm</span>");
    expect(html).not.toContain("up to RM 0");
  });

  test("shows each company's books: the month states and what is left to collect, escaped", () => {
    const dir = scratch();
    write(
      dir,
      "entities/acme.md",
      profile.replace("close: monthly", 'close: monthly\nbooked_through: "2026-08"').replace("## Obligations", "## Accounts\n\n```yaml\n- { id: main, name: <Main> account }\n```\n\n## Obligations")
    );
    const html = renderDashboard(dir, "2026-10-08");
    expect(html).toContain("booked through Aug 2026 · 1 month not booked · 1 needs you");
    expect(html).toContain("&lt;Main&gt; account statement · Sep 2026");
    expect(html).not.toContain("<Main>");
  });

  test("a profile with booked_through unquoted stops the run instead of reading a wrong month", () => {
    const dir = scratch();
    write(dir, "entities/acme.md", profile.replace("close: monthly", "close: monthly\nbooked_through: 2026-07"));
    expect(() => renderDashboard(dir, "2026-10-08")).toThrow("booked_through");
  });

  test("a partial close leaves the year unpriced, never RM 0", () => {
    const dir = scratch();
    write(dir, "entities/acme.md", profile.replace("kind: company", "kind: company\ncountry: my"));
    const partial = '---\nmonth: "2026-08"\nstatus: partial\n---\n\n## Gaps\n\n```yaml\n- { date: "2026-08-12", account: main, amount: 90000, direction: in, need: explanation }\n```\n';
    write(dir, "closes/acme/2026-08.md", partial);
    const html = renderDashboard(dir, "2026-09-20");
    expect(html).toContain('<div class="hero-figure">—</div>');
    write(dir, "closes/acme/2026-08.md", '---\nmonth: "2026-08"\nstatus: closed\n---\n');
    expect(renderDashboard(dir, "2026-09-20")).toContain('<div class="hero-figure">RM 0</div>');
  });

  test("switches tabs with CSS alone: one radio and one panel per entity plus the overview", () => {
    const dir = scratch();
    write(dir, "entities/acme.md", profile);
    const html = renderDashboard(dir, "2026-10-08");
    expect(html).toContain('id="tab-overview" checked');
    expect(html).toContain('id="panel-acme"');
    expect(html).toContain("#tab-acme:checked~.panels #panel-acme{display:block}");
  });
});

describe("country catalogs", () => {
  const countries = join(import.meta.dir, "..", "references", "countries");
  const blocks = readdirSync(countries)
    .filter((file) => file.endsWith(".md"))
    .flatMap((file) =>
      Array.from(readFileSync(join(countries, file), "utf8").matchAll(/```yaml\n([\s\S]*?)```/g), (match) => ({
        file,
        yaml: match[1],
      }))
    )
    .filter((block) => Array.isArray(Bun.YAML.parse(block.yaml)));

  test("ship at least one obligation block", () => {
    expect(blocks.length).toBeGreaterThan(0);
  });

  test.each(blocks.map((block, i) => [`${block.file} block ${i + 1}`, block.yaml]))(
    "%s parses as obligations the engine accepts",
    (_, yaml) => {
      const entity = parseEntity("catalog", `---\nname: Catalog\nfye: 12-31\n---\n\n## Obligations\n\n\`\`\`yaml\n${yaml}\`\`\`\n`);
      expect(entity.obligations.length).toBeGreaterThan(0);
      expect(occurrences(entity, "2027-01-01", "2027-12-31").length).toBeGreaterThan(0);
    }
  );
});

test("addDays crosses month and year boundaries", () => {
  expect(addDays("2027-01-01", -31)).toBe("2026-12-01");
  expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
});
