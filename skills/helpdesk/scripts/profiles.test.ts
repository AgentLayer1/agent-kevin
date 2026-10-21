import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lastRun, parseProfile, routinesDue } from "./profiles";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const fixture = (profiles: Record<string, string>, reports: string[] = []): { projects: string; reports: string } => {
  const root = mkdtempSync(join(tmpdir(), "helpdesk-profiles-"));
  dirs.push(root);
  const projects = join(root, "projects");
  const reportsDir = join(root, "reports", "helpdesk");
  mkdirSync(reportsDir, { recursive: true });
  for (const [slug, raw] of Object.entries(profiles)) {
    mkdirSync(join(projects, slug), { recursive: true });
    writeFileSync(join(projects, slug, "helpdesk.md"), raw);
  }
  mkdirSync(join(projects, "no-queue"), { recursive: true });
  for (const name of reports) writeFileSync(join(reportsDir, name), "");
  return { projects, reports: reportsDir };
};

const profile = (frontmatter: string, body = "## Triage\n- Ask for the app version first\n"): string => `---\n${frontmatter}\n---\n\n${body}`;
const DIGEST = "## Workflow: digest\n1. Sum up the week for the team.\n";

describe("parseProfile", () => {
  test("reads helpdesk, connection, statuses and the schedule", () => {
    expect(
      parseProfile("acme/helpdesk.md", "acme", profile("helpdesk: supportcandy\nconnection: shop\nstatuses: [Open, Awaiting agent reply]\nschedule: [pulse:daily, Digest:Weekly]", DIGEST))
    ).toEqual({
      slug: "acme",
      helpdesk: "supportcandy",
      connection: "shop",
      statuses: ["Open", "Awaiting agent reply"],
      schedule: [
        { routine: "pulse", cadence: "daily" },
        { routine: "digest", cadence: "weekly" },
      ],
    });
    expect(parseProfile("acme/helpdesk.md", "acme", profile("statuses: [new]"))).toEqual({ slug: "acme", statuses: ["new"], schedule: [] });
  });

  test("refuses a bad profile, naming the file and the problem", () => {
    const bad = (frontmatter: string, body?: string) => () => parseProfile("acme/helpdesk.md", "acme", profile(frontmatter, body));
    expect(() => parseProfile("acme/helpdesk.md", "acme", "# no frontmatter")).toThrow("acme/helpdesk.md: no frontmatter");
    expect(bad("schedule: [pulse:weekly]")).toThrow("statuses must list");
    expect(bad("statuses: [new]\nhelpdesk: zendesk")).toThrow("helpdesk must be one of");
    expect(bad("statuses: [new]\nconnection: ''")).toThrow("connection must be");
    expect(bad("statuses: [new]\nschedule: [pulse:hourly]")).toThrow('"pulse:hourly" needs a cadence');
    expect(bad("statuses: [new]\nschedule: [digest:weekly]")).toThrow('no "## Workflow: digest" section');
    expect(bad("statuses: [new]\nschedule: [draft:weekly]", "## Workflow: draft\n")).toThrow("isn't ticket, account, draft");
    expect(bad("statuses: [new]\nschedule: [week-digest:weekly]")).toThrow("letters and digits");
    expect(bad("statuses: [new]\nappstore: acme")).toThrow("appstore must be the app's numeric App Store id");
    expect(bad("statuses: [new]\nappstore: 1234567890\nstorefronts: [usa]")).toThrow("two-letter storefront codes");
    expect(bad("statuses: [new]\nstorefronts: [us]")).toThrow("storefronts needs appstore");
  });

  test("reads the App Store app as text, and storefronts lowercased", () => {
    expect(parseProfile("acme/helpdesk.md", "acme", profile("statuses: [new]\nappstore: 1234567890\nstorefronts: [US, gb]"))).toEqual({
      slug: "acme",
      statuses: ["new"],
      schedule: [],
      appstore: "1234567890",
      storefronts: ["us", "gb"],
    });
    expect(parseProfile("acme/helpdesk.md", "acme", profile("statuses: [new]\nappstore: '1234567890'")).appstore).toBe("1234567890");
  });
});

describe("lastRun", () => {
  test("is the newest report for that routine and queue only, never a queue whose slug extends it", () => {
    const { reports } = fixture({}, [
      "2026-10-05-0900-pulse-acme.md",
      "2026-10-12-0900-pulse-acme.md",
      "2026-10-19-0800-pulse-acme-2.md",
      "2026-10-20-0800-digest-acme.md",
      "2026-10-21-0800-other.md",
    ]);
    expect(lastRun(reports, "pulse", "acme")).toBe("2026-10-12");
    expect(lastRun(reports, "pulse", "acme-2")).toBe("2026-10-19");
    expect(lastRun(reports, "digest", "acme")).toBe("2026-10-20");
    expect(lastRun(reports, "pulse", "zeta")).toBeNull();
  });
});

describe("routinesDue", () => {
  test("each scheduled routine is due until it has a report in its period; nothing scheduled never nudges", () => {
    const { projects, reports } = fixture(
      { acme: profile("statuses: [new]\nschedule: [pulse:daily, digest:weekly]", DIGEST), quiet: profile("statuses: [new]") },
      ["2026-10-21-0700-pulse-acme.md", "2026-10-16-0900-digest-acme.md"]
    );
    expect(routinesDue(projects, reports, "2026-10-21")).toEqual([{ invoke: "helpdesk digest acme", label: "Helpdesk digest: acme (weekly)", lastRun: "2026-10-16" }]);
    expect(routinesDue(projects, reports, "2026-10-22").map((item) => item.invoke)).toEqual(["helpdesk pulse acme", "helpdesk digest acme"]);
  });

  test("monthly buckets, and a never-run routine is due", () => {
    const { projects, reports } = fixture(
      { month: profile("statuses: [new]\nschedule: [pulse:monthly]"), fresh: profile("statuses: [new]\nschedule: [pulse:weekly]") },
      ["2026-10-01-0700-pulse-month.md"]
    );
    expect(routinesDue(projects, reports, "2026-10-21").map((item) => item.invoke)).toEqual(["helpdesk pulse fresh"]);
    expect(routinesDue(projects, reports, "2026-11-01").map((item) => item.invoke)).toEqual(["helpdesk pulse fresh", "helpdesk pulse month"]);
  });

  test("a broken profile becomes its own item and the rest still report", () => {
    const { projects, reports } = fixture({ broken: profile("schedule: [pulse:weekly]"), ok: profile("statuses: [new]\nschedule: [pulse:daily]") });
    const due = routinesDue(projects, reports, "2026-10-21");
    expect(due.map((item) => item.invoke)).toEqual(["helpdesk profile broken", "helpdesk pulse ok"]);
    expect(due[0]?.label).toContain("Fix the helpdesk profile");
  });
});
