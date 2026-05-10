import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "memory-injector-"));
  vi.resetModules();
  process.env.MEMORY_ROOT = tempRoot;
});

afterEach(async () => {
  delete process.env.MEMORY_ROOT;
  await rm(tempRoot, { recursive: true, force: true });
});

describe("getGlobalMemoryAppend", () => {
  it("returns '' when there are no memory files", async () => {
    const { getGlobalMemoryAppend } = await import("./global-injector");
    const { ensureMemoryTree } = await import("./paths");
    await ensureMemoryTree();
    expect(await getGlobalMemoryAppend()).toBe("");
  });

  it("returns '' when the directory does not exist at all", async () => {
    const { getGlobalMemoryAppend } = await import("./global-injector");
    expect(await getGlobalMemoryAppend()).toBe("");
  });

  it("concatenates files into a single block", async () => {
    const { writeMemoryFile } = await import("./store");
    const { ensureMemoryTree, globalMemoryDir } = await import("./paths");
    const { getGlobalMemoryAppend } = await import("./global-injector");
    await ensureMemoryTree();
    await writeMemoryFile(globalMemoryDir(), "preferences.md", "Use TypeScript strict mode.");
    await writeMemoryFile(globalMemoryDir(), "facts/team.md", "Team channel: #eng.");

    const out = await getGlobalMemoryAppend();
    expect(out.startsWith("# Global Memory")).toBe(true);
    expect(out).toContain("## preferences.md");
    expect(out).toContain("Use TypeScript strict mode.");
    expect(out).toContain("## facts/team.md");
    expect(out).toContain("Team channel: #eng.");
  });

  it("skips empty files", async () => {
    const { writeMemoryFile } = await import("./store");
    const { ensureMemoryTree, globalMemoryDir } = await import("./paths");
    const { getGlobalMemoryAppend } = await import("./global-injector");
    await ensureMemoryTree();
    await writeMemoryFile(globalMemoryDir(), "real.md", "kept");
    await writeMemoryFile(globalMemoryDir(), "blank.md", "   \n  \t\n");

    const out = await getGlobalMemoryAppend();
    expect(out).toContain("## real.md");
    expect(out).not.toContain("## blank.md");
  });
});
