import { describe, it, expect } from "vitest";
import { safePath, safeFilename, SafePathError } from "./safe-path";
import { resolve } from "path";
import { homedir } from "os";

// Must match the logic in safe-path.ts
const dev = process.env.NODE_ENV !== "production";
const BASE_DIR = process.env.CLAUDE_CWD || (dev ? homedir() : "/workspace");
const RESOLVED_BASE = resolve(BASE_DIR);

describe("safePath", () => {
  it("accepts paths within the base directory", async () => {
    const result = await safePath(`${BASE_DIR}/package.json`);
    expect(result).toBe(resolve(BASE_DIR, "package.json"));
  });

  it("accepts relative paths that resolve within base directory", async () => {
    // Relative paths resolve from CWD — only valid when CWD is inside BASE_DIR.
    const cwd = process.cwd();
    const resolvedCwd = resolve(cwd);
    if (!resolvedCwd.startsWith(RESOLVED_BASE)) {
      // CWD is outside BASE_DIR (e.g. running tests on dev machine) — expect rejection
      await expect(safePath("./package.json")).rejects.toThrow(SafePathError);
    } else {
      const result = await safePath("./package.json");
      expect(result).toContain("package.json");
    }
  });

  it("rejects paths that traverse above the base directory", async () => {
    await expect(safePath("../../../etc/passwd")).rejects.toThrow(SafePathError);
  });

  it("rejects /etc/passwd directly", async () => {
    await expect(safePath("/etc/passwd")).rejects.toThrow(SafePathError);
  });

  it("rejects /etc/shadow", async () => {
    await expect(safePath("/etc/shadow")).rejects.toThrow(SafePathError);
  });

  it("rejects paths with encoded traversal", async () => {
    await expect(safePath(`${BASE_DIR}/../../../etc/passwd`)).rejects.toThrow(SafePathError);
  });

  it("rejects paths that use ~ to escape", async () => {
    // ~ expands to homedir; if homedir is outside BASE_DIR, this should fail
    const home = homedir();
    if (!home.startsWith(BASE_DIR)) {
      await expect(safePath("~/../../etc/passwd")).rejects.toThrow(SafePathError);
    }
  });

  it("handles non-existent files within the base directory (for writes)", async () => {
    const result = await safePath(`${BASE_DIR}/nonexistent-test-file-xyz.txt`);
    expect(result).toBe(resolve(BASE_DIR, "nonexistent-test-file-xyz.txt"));
  });

  it("handles deeply nested non-existent paths within base directory", async () => {
    const result = await safePath(`${BASE_DIR}/a/b/c/deep-file.txt`);
    expect(result).toContain(RESOLVED_BASE);
  });
});

describe("safeFilename", () => {
  it("strips directory components from filenames", () => {
    expect(safeFilename("../../../etc/passwd")).toBe("passwd");
  });

  it("strips leading directories", () => {
    expect(safeFilename("foo/bar/baz.txt")).toBe("baz.txt");
  });

  it("returns simple filenames unchanged", () => {
    expect(safeFilename("document.pdf")).toBe("document.pdf");
  });

  it("handles dotfiles", () => {
    expect(safeFilename(".env")).toBe(".env");
  });

  it("strips absolute path prefix", () => {
    expect(safeFilename("/tmp/evil.sh")).toBe("evil.sh");
  });
});
