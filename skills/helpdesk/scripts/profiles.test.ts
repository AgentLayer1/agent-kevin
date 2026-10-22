import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lastRun, parseProfile, reviewReads, reviewsSince, routinesDue } from "./profiles";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const fixture = (profiles: Record<string, string>, reports: (string | [name: string, content: string])[] = []): { projects: string; reports: string } => {
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
  for (const report of reports) {
    const [name, content] = typeof report === "string" ? [report, ""] : report;
    writeFileSync(join(reportsDir, name), content);
  }
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
    expect(bad("statuses: [new]\nschedule: [draft:weekly]")).toThrow("isn't ticket, account, draft");
    expect(bad("statuses: [new]\nschedule: [reviews:daily]")).toThrow('"reviews:daily" needs a routine name');
    expect(bad("statuses: [new]\nschedule: [week-digest:weekly]")).toThrow("letters and digits");
    expect(bad("statuses: [new]\nappstore: acme")).toThrow("appstore must be the app's numeric App Store id");
    expect(bad("statuses: [new]\nappstore: 1234567890\nstorefronts: [usa]")).toThrow("App Store storefront codes");
    expect(bad("statuses: [new]\nappstore: 1234567890\nstorefronts: [xx]")).toThrow("App Store storefront codes");
    expect(bad("statuses: [new]", "## Workflow: ticket\n")).toThrow('"## Workflow: ticket" needs a name');
    expect(bad("statuses: [new]", "## Workflow: raise\n")).toThrow('"## Workflow: raise" needs a name');
    expect(bad("statuses: [new]", "## Workflow: pulse\n")).toThrow('"## Workflow: pulse" needs a name');
    expect(bad("statuses: [new]", "## Workflow: reviews\n")).toThrow('"## Workflow: reviews" needs a name');
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

const watermark = (through?: string): string => `---\ntitle: "Helpdesk pulse"\n${through ? `reviews_through: "${through}"\n` : ""}---\nbody\n`;

describe("reviewsSince", () => {
  test("is the newest pulse or reviews report's through, passing over a report that has none", () => {
    const { reports } = fixture({}, [
      ["2026-10-05-0900-pulse-acme.md", watermark("2026-10-05T01:00:00.000Z")],
      ["2026-10-12-0900-reviews-acme.md", watermark("2026-10-12T01:00:00.000Z")],
      ["2026-10-14-0900-pulse-acme.md", watermark()],
      ["2026-10-15-0900-digest-acme.md", watermark("2026-10-15T01:00:00.000Z")],
      ["2026-10-16-0900-pulse-acme-2.md", watermark("2026-10-16T01:00:00.000Z")],
    ]);
    expect(reviewsSince(reports, "acme")).toBe("2026-10-12T01:00:00.000Z");
    expect(reviewsSince(reports, "acme-2")).toBe("2026-10-16T01:00:00.000Z");
    expect(reviewsSince(reports, "zeta")).toBeNull();
  });
});

describe("reviewReads", () => {
  test("one read per profile with an App Store app, from its watermark or the last week", () => {
    const { projects, reports } = fixture(
      {
        app: profile("statuses: [new]\nappstore: 1234567890\nstorefronts: [us]"),
        fresh: profile("statuses: [new]\nappstore: 1234567891"),
        quiet: profile("statuses: [new]"),
        broken: profile("appstore: 1234567892"),
      },
      [["2026-10-20-0900-pulse-app.md", watermark("2026-10-20T01:00:00.000Z")]]
    );
    expect(reviewReads(projects, reports)).toEqual([
      { slug: "app", app: "1234567890", storefronts: ["us"], since: "2026-10-20T01:00:00.000Z" },
      { slug: "fresh", app: "1234567891", since: "7d" },
    ]);
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
    expect(due.map((item) => item.invoke)).toEqual(["helpdesk setup broken", "helpdesk pulse ok"]);
    expect(due[0]?.label).toContain("Fix the helpdesk profile");
  });
});
