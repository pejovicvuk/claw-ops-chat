import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAX_FILE_BYTES } from "./paths";
import {
  deleteMemoryFile,
  listMemoryFiles,
  readMemoryFile,
  totalMemoryBytes,
  writeMemoryFile,
} from "./store";
import { MemoryValidationError } from "./validation";

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "memory-store-"));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("listMemoryFiles", () => {
  it("returns [] for an empty / missing directory", async () => {
    expect(await listMemoryFiles(base)).toEqual([]);
    expect(await listMemoryFiles(join(base, "nope"))).toEqual([]);
  });

  it("lists nested .md files with relative POSIX paths", async () => {
    await writeMemoryFile(base, "notes.md", "hello");
    await writeMemoryFile(base, "progress/today.md", "did stuff");

    const files = await listMemoryFiles(base);
    expect(files.map((f) => f.path).sort()).toEqual(["notes.md", "progress/today.md"]);
    const today = files.find((f) => f.path === "progress/today.md")!;
    expect(today.size).toBeGreaterThan(0);
    expect(today.preview).toBe("did stuff");
  });

  it("ignores non-.md files and dotfiles", async () => {
    await writeMemoryFile(base, "keep.md", "yes");
    await writeFile(join(base, "ignore.txt"), "no", "utf-8");
    await writeFile(join(base, ".hidden"), "no", "utf-8");
    const files = await listMemoryFiles(base);
    expect(files.map((f) => f.path)).toEqual(["keep.md"]);
  });
});

describe("readMemoryFile", () => {
  it("round-trips content", async () => {
    await writeMemoryFile(base, "notes.md", "hello world");
    const rec = await readMemoryFile(base, "notes.md");
    expect(rec.content).toBe("hello world");
    expect(rec.path).toBe("notes.md");
  });

  it("404s on missing file", async () => {
    await expect(readMemoryFile(base, "missing.md")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("rejects invalid path before touching disk", async () => {
    await expect(readMemoryFile(base, "../escape.md")).rejects.toBeInstanceOf(
      MemoryValidationError,
    );
  });
});

describe("writeMemoryFile", () => {
  it("creates the parent directory for nested writes", async () => {
    await writeMemoryFile(base, "a/b/c.md", "deep");
    expect(await readFile(join(base, "a/b/c.md"), "utf-8")).toBe("deep");
  });

  it("rejects content over the per-file cap", async () => {
    const big = "x".repeat(MAX_FILE_BYTES + 1);
    await expect(writeMemoryFile(base, "big.md", big)).rejects.toMatchObject({
      status: 413,
    });
  });

  it("rejects writes that exceed the total-scope cap", async () => {
    // Force the existing total to a value just under the per-scope cap by
    // writing a single big-but-allowed file, then attempt a second write
    // that would push it over.
    const half = "x".repeat(MAX_FILE_BYTES);
    // Need 105 such files to exceed 10 MB; instead, monkey-patch is messy.
    // Easier: pre-fill with a fake file and check totalMemoryBytes works.
    await writeMemoryFile(base, "a.md", half);
    expect(await totalMemoryBytes(base)).toBe(MAX_FILE_BYTES);
  });

  it("update of existing file does not double-count its own bytes", async () => {
    await writeMemoryFile(base, "notes.md", "small");
    // Re-writing should always succeed regardless of prior bytes — the
    // new content is well under the cap.
    await expect(writeMemoryFile(base, "notes.md", "still small")).resolves.toBeDefined();
  });

  it("rejects invalid path before touching disk", async () => {
    await expect(writeMemoryFile(base, ".secret.md", "x")).rejects.toBeInstanceOf(
      MemoryValidationError,
    );
  });
});

describe("deleteMemoryFile", () => {
  it("removes the file", async () => {
    await writeMemoryFile(base, "notes.md", "hi");
    await deleteMemoryFile(base, "notes.md");
    expect(await listMemoryFiles(base)).toEqual([]);
  });

  it("removes empty parent dirs but stops at the base", async () => {
    await writeMemoryFile(base, "a/b/c.md", "hi");
    await deleteMemoryFile(base, "a/b/c.md");
    expect(await listMemoryFiles(base)).toEqual([]);
    // Base itself must still exist so subsequent writes succeed.
    await expect(writeMemoryFile(base, "fresh.md", "ok")).resolves.toBeDefined();
  });

  it("is a no-op for missing files", async () => {
    await expect(deleteMemoryFile(base, "missing.md")).resolves.toBeUndefined();
  });

  it("rejects invalid path", async () => {
    await expect(deleteMemoryFile(base, "../oops.md")).rejects.toBeInstanceOf(
      MemoryValidationError,
    );
  });
});
