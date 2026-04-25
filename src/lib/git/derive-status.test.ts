import { describe, it, expect } from "vitest";
import { buildStatusByPath, computeDirtyAncestors, deriveFileStatus } from "./derive-status";
import type { GitStatusFile } from "./types";

describe("deriveFileStatus", () => {
  it("prefers worktree status over index status", () => {
    expect(deriveFileStatus({ path: "/x", index: "staged", worktree: "modified" })).toBe(
      "modified",
    );
  });

  it("falls back to index when worktree is null", () => {
    expect(deriveFileStatus({ path: "/x", index: "staged", worktree: null })).toBe("staged");
  });

  it("returns null when both are null", () => {
    expect(deriveFileStatus({ path: "/x", index: null, worktree: null })).toBeNull();
  });
});

describe("buildStatusByPath", () => {
  it("indexes files by path with the derived status", () => {
    const files: GitStatusFile[] = [
      { path: "/r/a.ts", index: null, worktree: "modified" },
      { path: "/r/b.ts", index: "staged", worktree: null },
      { path: "/r/c.log", index: null, worktree: "untracked" },
    ];
    const map = buildStatusByPath(files);
    expect(map.size).toBe(3);
    expect(map.get("/r/a.ts")).toBe("modified");
    expect(map.get("/r/b.ts")).toBe("staged");
    expect(map.get("/r/c.log")).toBe("untracked");
  });

  it("skips files with no derivable status", () => {
    const files: GitStatusFile[] = [{ path: "/r/x", index: null, worktree: null }];
    expect(buildStatusByPath(files).size).toBe(0);
  });
});

describe("computeDirtyAncestors", () => {
  it("collects every directory between repoRoot and each changed file", () => {
    const files: GitStatusFile[] = [
      { path: "/repo/src/lib/foo.ts", index: null, worktree: "modified" },
    ];
    const set = computeDirtyAncestors(files, "/repo");
    expect(set.has("/repo/src")).toBe(true);
    expect(set.has("/repo/src/lib")).toBe(true);
    expect(set.has("/repo")).toBe(false);
  });

  it("does not duplicate ancestors when multiple files share a parent", () => {
    const files: GitStatusFile[] = [
      { path: "/repo/src/a.ts", index: null, worktree: "modified" },
      { path: "/repo/src/b.ts", index: null, worktree: "untracked" },
    ];
    const set = computeDirtyAncestors(files, "/repo");
    expect(set.size).toBe(1);
    expect(set.has("/repo/src")).toBe(true);
  });

  it("returns an empty set when there are no changed files", () => {
    expect(computeDirtyAncestors([], "/repo").size).toBe(0);
  });

  it("does not climb above repoRoot", () => {
    const files: GitStatusFile[] = [{ path: "/repo/a.ts", index: null, worktree: "modified" }];
    const set = computeDirtyAncestors(files, "/repo");
    expect(set.has("/")).toBe(false);
    expect(set.has("/repo")).toBe(false);
  });
});
