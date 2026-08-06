import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrainCommitStatus, commitBrain, parseStatusZ } from "./commit-brain";

/**
 * Guard matrix for the brain committer. Always runs against scratch repos under
 * mkdtemp — never a live HOME. Asserts the safety contract the sync skill
 * documents: local-only + main-only, grouped commits, secrets and stray files
 * never swept into history.
 */
const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const write = (home: string, file: string, body: string): void => {
  mkdirSync(join(home, file, ".."), { recursive: true });
  writeFileSync(join(home, file), body);
};

const SEED_FILES = [
  ".gitignore",
  "USER.md",
  "knowledge/index.md",
  "knowledge/memory/2026-07-01.md",
  "projects/TASKS.md",
  "reports/index.md",
  "dashboard.html",
];

/** Seed a local-only repo on main with the standard layout committed. `initArgs` lets a test split the git dir. */
const seedHome = (home: string, initArgs: string[] = []): string => {
  git(home, "init", "-b", "main", ...initArgs);
  git(home, "config", "user.email", "test@example.com");
  git(home, "config", "user.name", "Test");
  mkdirSync(join(home, ".kevin"), { recursive: true });
  write(home, ".gitignore", ".env\n.kevin/*\n");
  for (const file of SEED_FILES.slice(1)) {
    write(home, file, `seed ${file}\n`);
  }
  git(home, "add", ".");
  git(home, "commit", "-qm", "seed");
  return home;
};

const makeHome = (): string => seedHome(mkdtempSync(join(tmpdir(), "brain-commit-")));

const commitCount = (home: string): number => Number(git(home, "rev-list", "--count", "HEAD"));

const filesIn = (home: string, sha: string): string[] =>
  git(home, "show", "--name-status", "--format=", sha).split("\n").filter(Boolean);

describe("parseStatusZ", () => {
  test("plain entries", () => {
    expect(parseStatusZ(" M a.md\0?? b/\0 D c.md\0")).toEqual([
      { code: " M", path: "a.md" },
      { code: "??", path: "b/" },
      { code: " D", path: "c.md" },
    ]);
  });

  test("rename carries the original path", () => {
    expect(parseStatusZ("R  new.md\0old.md\0 M x.md\0")).toEqual([
      { code: "R ", path: "new.md", origPath: "old.md" },
      { code: " M", path: "x.md" },
    ]);
  });
});

describe("commitBrain guards", () => {
  test("not a repo", () => {
    const home = mkdtempSync(join(tmpdir(), "brain-commit-norepo-"));
    expect(commitBrain(home).status).toBe(BrainCommitStatus.NotARepo);
    rmSync(home, { recursive: true, force: true });
  });

  test("remote configured → skipped, nothing committed", () => {
    const home = makeHome();
    git(home, "remote", "add", "origin", "git@github.com:acme/brain.git");
    write(home, "knowledge/index.md", "changed\n");
    const before = commitCount(home);
    expect(commitBrain(home).status).toBe(BrainCommitStatus.SkippedHasRemote);
    expect(commitCount(home)).toBe(before);
    rmSync(home, { recursive: true, force: true });
  });

  test("non-main branch → skipped", () => {
    const home = makeHome();
    git(home, "checkout", "-qb", "feature");
    write(home, "knowledge/index.md", "changed\n");
    const outcome = commitBrain(home);
    expect(outcome.status).toBe(BrainCommitStatus.SkippedNotMain);
    expect(outcome.detail).toContain("feature");
    rmSync(home, { recursive: true, force: true });
  });

  test("detached HEAD → skipped", () => {
    const home = makeHome();
    git(home, "checkout", "-q", "--detach");
    expect(commitBrain(home).status).toBe(BrainCommitStatus.SkippedNotMain);
    rmSync(home, { recursive: true, force: true });
  });

  test("clean tree → CLEAN", () => {
    const home = makeHome();
    const outcome = commitBrain(home);
    expect(outcome.status).toBe(BrainCommitStatus.Clean);
    expect(outcome.commits).toEqual([]);
    rmSync(home, { recursive: true, force: true });
  });
});

describe("commitBrain grouping", () => {
  test("changes land in ordered group commits; strays and secrets stay out", () => {
    const home = makeHome();
    write(home, "knowledge/index.md", "changed\n");
    write(home, "USER.md", "changed\n");
    unlinkSync(join(home, "knowledge/memory/2026-07-01.md"));
    write(home, "projects/TASKS.md", "changed\n");
    write(home, "reports/briefings/2026-08-06-morning.md", "new report\n");
    write(home, "dashboard.html", "changed\n");
    write(home, ".env", "SECRET=1\n");
    write(home, "stray.txt", "scratch\n");

    const outcome = commitBrain(home);
    expect(outcome.status).toBe(BrainCommitStatus.Committed);
    expect(outcome.commits.map((entry) => entry.message)).toEqual([
      "Sync: update knowledge",
      "Sync: update projects",
      "Sync: save reports",
      "Sync: update state",
    ]);

    const [knowledge, projects, reports, state] = outcome.commits;
    expect(filesIn(home, knowledge.sha).sort()).toEqual([
      "D\tknowledge/memory/2026-07-01.md",
      "M\tUSER.md",
      "M\tknowledge/index.md",
    ]);
    expect(filesIn(home, projects.sha)).toEqual(["M\tprojects/TASKS.md"]);
    expect(filesIn(home, reports.sha)).toEqual(["A\treports/briefings/2026-08-06-morning.md"]);
    expect(filesIn(home, state.sha)).toEqual(["M\tdashboard.html"]);

    expect(outcome.leftUncommitted).toEqual(["stray.txt"]);
    expect(git(home, "status", "--porcelain")).toBe("?? stray.txt");
    expect(git(home, "ls-files")).not.toContain(".env");
    rmSync(home, { recursive: true, force: true });
  });

  test("tracked change outside every group falls through to the state commit", () => {
    const home = makeHome();
    write(home, "notes.md", "tracked root file\n");
    git(home, "add", "notes.md");
    git(home, "commit", "-qm", "track a root file");
    write(home, "notes.md", "changed\n");

    const outcome = commitBrain(home);
    expect(outcome.status).toBe(BrainCommitStatus.Committed);
    expect(outcome.commits.map((entry) => entry.message)).toEqual(["Sync: update state"]);
    expect(filesIn(home, outcome.commits[0].sha)).toEqual(["M\tnotes.md"]);
    rmSync(home, { recursive: true, force: true });
  });

  test("separated git dir (the live HOME topology) commits normally", () => {
    const root = mkdtempSync(join(tmpdir(), "brain-commit-split-"));
    const home = join(root, "home");
    mkdirSync(home);
    seedHome(home, ["--separate-git-dir", join(root, "data.git")]);
    write(home, "knowledge/index.md", "changed\n");
    const outcome = commitBrain(home);
    expect(outcome.status).toBe(BrainCommitStatus.Committed);
    expect(outcome.commits.map((entry) => entry.message)).toEqual(["Sync: update knowledge"]);
    rmSync(root, { recursive: true, force: true });
  });
});
