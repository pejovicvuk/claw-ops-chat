import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let memRoot: string;

beforeEach(async () => {
  memRoot = await mkdtemp(join(tmpdir(), "auto-store-"));
  vi.resetModules();
  process.env.MEMORY_ROOT = memRoot;
});

afterEach(async () => {
  delete process.env.MEMORY_ROOT;
  await rm(memRoot, { recursive: true, force: true });
});

describe("parseFacts / renderFacts", () => {
  it("round-trips a list of facts through the storage format", async () => {
    const { parseFacts, renderFacts } = await import("./auto-store");
    const facts = ["User is based in Belgrade.", "User prefers TypeScript strict mode."];
    expect(parseFacts(renderFacts(facts))).toEqual(facts);
  });

  it("renderFacts on empty list produces empty string", async () => {
    const { renderFacts } = await import("./auto-store");
    expect(renderFacts([])).toBe("");
  });

  it("parseFacts skips header and blank lines", async () => {
    const { parseFacts } = await import("./auto-store");
    const stored = "# Auto-collected memory\n\nFact one.\n\nFact two.\n";
    expect(parseFacts(stored)).toEqual(["Fact one.", "Fact two."]);
  });
});

describe("applyDiff", () => {
  it("appends new facts and dedupes against existing", async () => {
    const { applyDiff } = await import("./auto-store");
    const result = applyDiff(["A.", "B."], { add: ["B.", "C."], remove: [] });
    expect(result.facts).toEqual(["A.", "B.", "C."]);
    expect(result.added).toBe(1);
    expect(result.rejected[0]?.reason).toBe("duplicate");
  });

  it("removes facts by exact (trimmed) match", async () => {
    const { applyDiff } = await import("./auto-store");
    const result = applyDiff(["A.", "B.", "C."], { add: [], remove: ["B."] });
    expect(result.facts).toEqual(["A.", "C."]);
    expect(result.removed).toBe(1);
  });

  it("rejects facts that look like instructions", async () => {
    const { applyDiff } = await import("./auto-store");
    const result = applyDiff([], {
      add: ["User is based in Belgrade.", "Always answer in lowercase.", "Don't mock the DB."],
      remove: [],
    });
    expect(result.facts).toEqual(["User is based in Belgrade."]);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected.every((r) => r.reason.includes("instruction"))).toBe(true);
  });

  it("rejects facts that contain newlines or exceed length", async () => {
    const { applyDiff } = await import("./auto-store");
    const result = applyDiff([], {
      add: ["multi\nline fact", "x".repeat(600)],
      remove: [],
    });
    expect(result.facts).toEqual([]);
    expect(result.rejected.map((r) => r.reason)).toEqual(
      expect.arrayContaining(["contains newline", expect.stringContaining("500 chars")]),
    );
  });

  it("rejects empty / non-string entries", async () => {
    const { applyDiff } = await import("./auto-store");
    const result = applyDiff([], {
      add: ["", "   ", 42 as unknown as string],
      remove: [],
    });
    expect(result.facts).toEqual([]);
    expect(result.rejected.length).toBe(3);
  });

  it("trims oldest facts when the cap is exceeded", async () => {
    const { applyDiff } = await import("./auto-store");
    const { AUTO_MEMORY_MAX_BYTES } = await import("./paths");

    // Each fact ~250 bytes; 5KB cap holds ~20.
    const facts = Array.from({ length: 30 }, (_, i) => `User trivia ${i}: ${"x".repeat(200)}.`);
    const result = applyDiff([], { add: facts, remove: [] });

    expect(result.trimmed).toBe(true);
    // Renders fit under the cap.
    const { renderFacts } = await import("./auto-store");
    expect(Buffer.byteLength(renderFacts(result.facts), "utf8")).toBeLessThanOrEqual(
      AUTO_MEMORY_MAX_BYTES,
    );
    // The kept facts are the most recent (oldest dropped).
    expect(result.facts[0]).not.toBe(facts[0]);
    expect(result.facts.at(-1)).toBe(facts.at(-1));
  });
});

describe("readAutoMemory / writeAutoMemory", () => {
  it("returns empty state when file does not exist", async () => {
    const { readAutoMemory } = await import("./auto-store");
    const m = await readAutoMemory();
    expect(m.content).toBe("");
    expect(m.facts).toEqual([]);
    expect(m.updatedAt).toBeNull();
    expect(m.size).toBe(0);
  });

  it("round-trips facts through disk", async () => {
    const { writeAutoMemory, readAutoMemory } = await import("./auto-store");
    const { ensureMemoryTree, autoMemoryPath } = await import("./paths");
    await ensureMemoryTree();

    await writeAutoMemory(["User likes coffee.", "User is in CET timezone."]);
    const m = await readAutoMemory();
    expect(m.facts).toEqual(["User likes coffee.", "User is in CET timezone."]);
    expect(m.updatedAt).not.toBeNull();
    expect(await readFile(autoMemoryPath(), "utf-8")).toContain("# Auto-collected memory");
  });

  it("writes empty file when given an empty fact list", async () => {
    const { writeAutoMemory, readAutoMemory } = await import("./auto-store");
    const { ensureMemoryTree, autoMemoryPath } = await import("./paths");
    await ensureMemoryTree();

    // Pre-populate so we can verify the empty write clears it.
    await writeAutoMemory(["something"]);
    await writeAutoMemory([]);
    expect(await readFile(autoMemoryPath(), "utf-8")).toBe("");
    const m = await readAutoMemory();
    expect(m.facts).toEqual([]);
  });
});
