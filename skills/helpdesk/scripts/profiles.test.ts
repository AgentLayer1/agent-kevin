import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lastPulse, parseProfile, pulsesDue } from "./profiles";

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

const profile = (frontmatter: string): string => `---\n${frontmatter}\n---\n\n## Triage\n- Ask for the app version first\n`;

describe("parseProfile", () => {
  test("reads helpdesk, statuses and cadence", () => {
    expect(parseProfile("acme/helpdesk.md", "acme", profile("helpdesk: supportcandy\nstatuses: [Open, Awaiting agent reply]\ncadence: weekly"))).toEqual({
      slug: "acme",
      helpdesk: "supportcandy",
      statuses: ["Open", "Awaiting agent reply"],
      cadence: "weekly",
    });
    expect(parseProfile("acme/helpdesk.md", "acme", profile("statuses: [new]"))).toEqual({ slug: "acme", statuses: ["new"] });
  });

  test("refuses missing statuses, nested values, and unknown helpdesks or cadences, naming the file", () => {
    expect(() => parseProfile("acme/helpdesk.md", "acme", "# no frontmatter")).toThrow("acme/helpdesk.md: no frontmatter");
    expect(() => parseProfile("acme/helpdesk.md", "acme", profile("cadence: weekly"))).toThrow("statuses must list");
    expect(() => parseProfile("acme/helpdesk.md", "acme", profile("statuses: [new]\nrouting:\n  bug: pw"))).toThrow("must be flat (routing)");
    expect(() => parseProfile("acme/helpdesk.md", "acme", profile("statuses: [new]\nhelpdesk: zendesk"))).toThrow("helpdesk must be one of");
    expect(() => parseProfile("acme/helpdesk.md", "acme", profile("statuses: [new]\ncadence: hourly"))).toThrow("cadence must be one of");
  });
});

describe("lastPulse", () => {
  test("is the newest pulse for that queue only, collision suffixes included", () => {
    const { reports } = fixture({}, ["2026-10-05-0900-pulse-acme.md", "2026-10-19-0800-pulse-acme-2.md", "2026-10-20-0800-pulse-acme-web.md", "2026-10-21-0800-other.md"]);
    expect(lastPulse(reports, "acme")).toBe("2026-10-19");
    expect(lastPulse(reports, "zeta")).toBeNull();
  });
});

describe("pulsesDue", () => {
  test("a weekly queue is due until it has a pulse this ISO week; no cadence never nudges", () => {
    const { projects, reports } = fixture(
      { acme: profile("statuses: [new]\ncadence: weekly"), quiet: profile("statuses: [new]") },
      ["2026-10-16-0900-pulse-acme.md"]
    );
    expect(pulsesDue(projects, reports, "2026-10-21")).toEqual([{ invoke: "helpdesk pulse acme", label: "Helpdesk pulse: acme (weekly)", lastRun: "2026-10-16" }]);
    expect(pulsesDue(projects, reports, "2026-10-18")).toEqual([]);
  });

  test("daily and monthly buckets, and a never-run queue is due", () => {
    const { projects, reports } = fixture(
      { day: profile("statuses: [new]\ncadence: daily"), month: profile("statuses: [new]\ncadence: monthly"), fresh: profile("statuses: [new]\ncadence: weekly") },
      ["2026-10-21-0700-pulse-day.md", "2026-10-01-0700-pulse-month.md"]
    );
    expect(pulsesDue(projects, reports, "2026-10-21").map((item) => item.invoke)).toEqual(["helpdesk pulse fresh"]);
    expect(pulsesDue(projects, reports, "2026-11-01").map((item) => item.invoke)).toEqual(["helpdesk pulse day", "helpdesk pulse fresh", "helpdesk pulse month"]);
  });

  test("a broken profile becomes its own item and the rest still report", () => {
    const { projects, reports } = fixture({ broken: profile("cadence: weekly"), ok: profile("statuses: [new]\ncadence: daily") });
    const due = pulsesDue(projects, reports, "2026-10-21");
    expect(due.map((item) => item.invoke)).toEqual(["helpdesk profile broken", "helpdesk pulse ok"]);
    expect(due[0]?.label).toContain("Fix the helpdesk profile");
  });
});
