#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { agentHomePath, env, isAgentHome } from "../../../mcp-server/src/shared/env";
import { agentKeyName, runtimeDirName } from "../../../mcp-server/src/shared/naming";
import { expandTilde } from "../../../mcp-server/src/shared/paths";

/**
 * Brain committer for sync — commits the HOME repo's pending changes as grouped,
 * forward-only commits, but ONLY when the repo is the local-only brain: on
 * main/master with no remote configured. Never pushes, never amends. Untracked
 * files outside the known content roots are reported, not swept into history.
 *
 * Usage: bun commit-brain.ts — prints a single JSON result for the skill to render.
 */

export const BrainCommitStatus = {
  NotARepo: "NOT_A_REPO",
  SkippedHasRemote: "SKIPPED_HAS_REMOTE",
  SkippedNotMain: "SKIPPED_NOT_MAIN",
  Clean: "CLEAN",
  Committed: "COMMITTED",
  CommitBlocked: "COMMIT_BLOCKED",
} as const;
export type BrainCommitStatus = (typeof BrainCommitStatus)[keyof typeof BrainCommitStatus];

export interface Change {
  code: string;
  path: string;
  origPath?: string;
}

export interface BrainCommit {
  message: string;
  sha: string;
  fileCount: number;
}

export interface BrainCommitResult {
  status: BrainCommitStatus;
  detail?: string;
  commits: BrainCommit[];
  leftUncommitted: string[];
}

interface Group {
  name: string;
  message: string;
  dirs: string[];
  files: string[];
}

const git = (home: string, ...args: string[]): string =>
  execFileSync("git", ["-C", home, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/** A relocatable root's HOME-relative path, or null when it's unset-and-defaulted or points outside the repo. */
const relocatedInside = (home: string, key: string): string | null | undefined => {
  const configured = env(key);
  if (!configured) {
    return undefined;
  }
  const rel = relative(home, expandTilde(configured));
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : null;
};

/**
 * The commit groups for a HOME, honouring the relocatable roots (`AGENT_KNOWLEDGE`
 * / `AGENT_PROJECTS` / `AGENT_REPORTS`). A root relocated outside the repo never
 * shows up in `git status`, so its group simply stays empty.
 */
export const brainGroups = (home: string): Group[] => {
  const root = (key: string, fallback: string): string[] => {
    const relocated = relocatedInside(home, key);
    return relocated === undefined ? [fallback] : relocated === null ? [] : [relocated];
  };
  return [
    {
      name: "knowledge",
      message: "Sync: update knowledge",
      dirs: root("AGENT_KNOWLEDGE", "knowledge"),
      files: ["USER.md", "SOUL.md", "IDENTITY.md", "CLAUDE.md"],
    },
    {
      name: "projects",
      message: "Sync: update projects",
      dirs: root("AGENT_PROJECTS", "projects"),
      files: [],
    },
    {
      name: "reports",
      message: "Sync: save reports",
      dirs: root("AGENT_REPORTS", "reports"),
      files: [],
    },
    {
      name: "state",
      message: "Sync: update state",
      dirs: [runtimeDirName(), ".claude", "archive"],
      files: ["dashboard.html", "roadmap.html", ".mcp.json"],
    },
  ];
};

/** Parse `git status --porcelain=v1 -z` output. Rename/copy entries carry the original path as a second NUL token. */
export const parseStatusZ = (raw: string): Change[] => {
  const tokens = raw.split("\0").filter((token) => token.length > 0);
  const changes: Change[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const code = tokens[i].slice(0, 2);
    const path = tokens[i].slice(3);
    const renamed = code.includes("R") || code.includes("C");
    changes.push(renamed ? { code, path, origPath: tokens[(i += 1)] } : { code, path });
  }
  return changes;
};

const inGroup = (group: Group, path: string): boolean =>
  group.files.includes(path) ||
  group.dirs.some((dir) => path === dir || path === `${dir}/` || path.startsWith(`${dir}/`));

/**
 * Assign each change to its commit group. Tracked changes that match no group
 * fall through to `state` (history should never silently drop a tracked edit);
 * untracked files that match no group are left out and reported.
 */
export const groupChanges = (
  groups: Group[],
  changes: Change[],
): { buckets: Map<string, Change[]>; leftUncommitted: string[] } => {
  const buckets = new Map<string, Change[]>(groups.map((group) => [group.name, []]));
  const leftUncommitted: string[] = [];
  for (const change of changes) {
    const matched = groups.find((group) => inGroup(group, change.path));
    if (matched) {
      buckets.get(matched.name)?.push(change);
    } else if (change.code === "??") {
      leftUncommitted.push(change.path);
    } else {
      buckets.get("state")?.push(change);
    }
  }
  return { buckets, leftUncommitted };
};

const hasStaged = (home: string): boolean => {
  try {
    git(home, "diff", "--cached", "--quiet");
    return false;
  } catch {
    return true;
  }
};

const inProgressOp = (home: string): boolean => {
  const gitDir = git(home, "rev-parse", "--absolute-git-dir");
  return ["MERGE_HEAD", "CHERRY_PICK_HEAD", "rebase-merge", "rebase-apply"].some((marker) =>
    existsSync(join(gitDir, marker)),
  );
};

const GRANT_HINT =
  "git could not write to the repo. If this HOME uses a split git dir, add that dir to permissions.additionalDirectories in <HOME>/.claude/settings.local.json so the sandbox can commit.";

export const commitBrain = (home: string): BrainCommitResult => {
  const result = (status: BrainCommitStatus, extra: Partial<BrainCommitResult> = {}): BrainCommitResult => ({
    status,
    commits: [],
    leftUncommitted: [],
    ...extra,
  });

  try {
    git(home, "rev-parse", "--git-dir");
  } catch {
    return result(BrainCommitStatus.NotARepo);
  }
  if (git(home, "remote") !== "") {
    return result(BrainCommitStatus.SkippedHasRemote, {
      detail: "repo has a remote — auto-commit is scoped to local-only brains",
    });
  }
  const branch = ((): string | null => {
    try {
      return git(home, "symbolic-ref", "--quiet", "--short", "HEAD");
    } catch {
      return null;
    }
  })();
  if (branch === null || !["main", "master"].includes(branch)) {
    return result(BrainCommitStatus.SkippedNotMain, {
      detail: branch === null ? "detached HEAD" : `on branch ${branch}`,
    });
  }
  if (inProgressOp(home)) {
    return result(BrainCommitStatus.SkippedNotMain, { detail: "merge/rebase/cherry-pick in progress" });
  }

  const changes = parseStatusZ(
    execFileSync("git", ["-C", home, "status", "--porcelain=v1", "-z"], { encoding: "utf8" }),
  );
  if (changes.length === 0) {
    return result(BrainCommitStatus.Clean);
  }

  const groups = brainGroups(home);
  const { buckets, leftUncommitted } = groupChanges(groups, changes);
  const commits: BrainCommit[] = [];
  try {
    for (const group of groups) {
      const bucket = buckets.get(group.name) ?? [];
      if (bucket.length === 0) {
        continue;
      }
      const paths = bucket.flatMap((change) => (change.origPath ? [change.path, change.origPath] : [change.path]));
      git(home, "add", "-A", "--", ...paths);
      if (!hasStaged(home)) {
        continue;
      }
      git(home, "commit", "-q", "-m", group.message);
      commits.push({
        message: group.message,
        sha: git(home, "rev-parse", "--short", "HEAD"),
        fileCount: bucket.length,
      });
    }
  } catch (error) {
    const failure = error as { stderr?: string; message?: string };
    return result(BrainCommitStatus.CommitBlocked, {
      detail: `${(failure.stderr || failure.message || String(error)).trim()} — ${GRANT_HINT}`,
      commits,
      leftUncommitted,
    });
  }
  return result(commits.length > 0 ? BrainCommitStatus.Committed : BrainCommitStatus.Clean, {
    commits,
    leftUncommitted,
  });
};

if (import.meta.main) {
  const home = agentHomePath();
  if (!isAgentHome(home)) {
    console.error(`not an agent home: ${home} — set ${agentKeyName("HOME")}`);
    process.exit(1);
  }
  console.log(JSON.stringify(commitBrain(home)));
}
