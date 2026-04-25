import { describe, it, expect } from "vitest";
import { parsePorcelainV2 } from "./parse-status";

const REPO = "/work/repo";

/** Build a NUL-separated porcelain v2 buffer from string records. */
function makeBuffer(records: string[]): Buffer {
  return Buffer.from(records.join("\0") + "\0", "utf-8");
}

describe("parsePorcelainV2", () => {
  it("parses a clean repo with branch headers only", () => {
    const buf = makeBuffer([
      "# branch.oid 1234567890abcdef1234567890abcdef12345678",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +0 -0",
    ]);
    const out = parsePorcelainV2(buf, REPO);
    expect(out.branch).toBe("main");
    expect(out.detachedHead).toBeNull();
    expect(out.ahead).toBe(0);
    expect(out.behind).toBe(0);
    expect(out.files).toEqual([]);
  });

  it("captures detached HEAD as the short SHA from branch.oid", () => {
    const buf = makeBuffer([
      "# branch.oid abcdef1234567890abcdef1234567890abcdef12",
      "# branch.head (detached)",
    ]);
    const out = parsePorcelainV2(buf, REPO);
    expect(out.branch).toBeNull();
    expect(out.detachedHead).toBe("abcdef1");
  });

  it("leaves ahead/behind null when no upstream is tracked", () => {
    const buf = makeBuffer([
      "# branch.oid 1111111111111111111111111111111111111111",
      "# branch.head feature",
    ]);
    const out = parsePorcelainV2(buf, REPO);
    expect(out.ahead).toBeNull();
    expect(out.behind).toBeNull();
  });

  it("parses positive ahead and behind counts", () => {
    const buf = makeBuffer([
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +3 -7",
    ]);
    const out = parsePorcelainV2(buf, REPO);
    expect(out.ahead).toBe(3);
    expect(out.behind).toBe(7);
  });

  it("parses a worktree-modified file (1 .M)", () => {
    const buf = makeBuffer([
      "# branch.head main",
      "1 .M N... 100644 100644 100644 abc def src/foo.ts",
    ]);
    const out = parsePorcelainV2(buf, REPO);
    expect(out.files).toEqual([
      { path: "/work/repo/src/foo.ts", index: null, worktree: "modified" },
    ]);
  });

  it("parses a staged-only modification (1 M.)", () => {
    const buf = makeBuffer([
      "# branch.head main",
      "1 M. N... 100644 100644 100644 abc def src/foo.ts",
    ]);
    const out = parsePorcelainV2(buf, REPO);
    expect(out.files[0]).toEqual({
      path: "/work/repo/src/foo.ts",
      index: "staged",
      worktree: null,
    });
  });

  it("parses an added (staged) new file (1 A.)", () => {
    const buf = makeBuffer([
      "# branch.head main",
      "1 A. N... 000000 100644 100644 0000 abcd new.txt",
    ]);
    const out = parsePorcelainV2(buf, REPO);
    expect(out.files[0]).toEqual({
      path: "/work/repo/new.txt",
      index: "staged",
      worktree: null,
    });
  });

  it("parses a deleted file (1 .D)", () => {
    const buf = makeBuffer([
      "# branch.head main",
      "1 .D N... 100644 100644 000000 abc 0000 gone.txt",
    ]);
    const out = parsePorcelainV2(buf, REPO);
    expect(out.files[0]).toEqual({
      path: "/work/repo/gone.txt",
      index: null,
      worktree: "deleted",
    });
  });

  it("parses an untracked file (?)", () => {
    const buf = makeBuffer(["# branch.head main", "? new.log"]);
    const out = parsePorcelainV2(buf, REPO);
    expect(out.files[0]).toEqual({
      path: "/work/repo/new.log",
      index: null,
      worktree: "untracked",
    });
  });

  it("parses a rename and consumes the orig-path token", () => {
    // For renames, the record itself contains an internal NUL between
    // <newPath> and <origPath>, and is then NUL-terminated again.
    const buf = Buffer.from(
      [
        "# branch.head main\0",
        "2 R. N... 100644 100644 100644 abc def R100 new/path.ts\0old/path.ts\0",
        "? after.txt\0",
      ].join(""),
      "utf-8",
    );
    const out = parsePorcelainV2(buf, REPO);
    expect(out.files).toEqual([
      { path: "/work/repo/new/path.ts", index: "renamed", worktree: null },
      { path: "/work/repo/after.txt", index: null, worktree: "untracked" },
    ]);
  });

  it("parses a conflicted (unmerged) entry", () => {
    const buf = makeBuffer([
      "# branch.head main",
      "u UU N... 100644 100644 100644 100644 a b c conflict.txt",
    ]);
    const out = parsePorcelainV2(buf, REPO);
    expect(out.files[0]).toEqual({
      path: "/work/repo/conflict.txt",
      index: "conflicted",
      worktree: "conflicted",
    });
  });

  it("ignores '!' (ignored) records", () => {
    const buf = makeBuffer(["# branch.head main", "! ignored.tmp"]);
    const out = parsePorcelainV2(buf, REPO);
    expect(out.files).toEqual([]);
  });

  it("preserves filenames containing spaces", () => {
    const buf = makeBuffer([
      "# branch.head main",
      "1 .M N... 100644 100644 100644 abc def my file with spaces.md",
    ]);
    const out = parsePorcelainV2(buf, REPO);
    expect(out.files[0].path).toBe("/work/repo/my file with spaces.md");
  });

  it("returns an empty result for an empty buffer", () => {
    const out = parsePorcelainV2(Buffer.alloc(0), REPO);
    expect(out.branch).toBeNull();
    expect(out.files).toEqual([]);
  });
});
