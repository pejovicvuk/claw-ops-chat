import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let memRoot: string;

beforeEach(async () => {
  memRoot = await mkdtemp(join(tmpdir(), "auto-config-"));
  vi.resetModules();
  process.env.MEMORY_ROOT = memRoot;
  delete process.env.AUTO_GLOBAL_MEMORY;
});

afterEach(async () => {
  delete process.env.MEMORY_ROOT;
  delete process.env.AUTO_GLOBAL_MEMORY;
  await rm(memRoot, { recursive: true, force: true });
});

describe("loadAutoMemoryConfig", () => {
  it("returns defaults when file does not exist", async () => {
    const { loadAutoMemoryConfig } = await import("./auto-config");
    const c = await loadAutoMemoryConfig();
    expect(c.enabled).toBe(true);
    expect(c.idleMs).toBe(60_000);
    expect(c.lastConsolidatedAt).toBeNull();
  });

  it("loads persisted values from disk", async () => {
    const { loadAutoMemoryConfig } = await import("./auto-config");
    const { autoMemoryConfigPath } = await import("./paths");
    await writeFile(
      autoMemoryConfigPath(),
      JSON.stringify({ enabled: false, idleMs: 30_000, lastConsolidatedAt: 1_700_000_000_000 }),
      "utf-8",
    );
    const c = await loadAutoMemoryConfig();
    expect(c).toEqual({
      enabled: false,
      idleMs: 30_000,
      lastConsolidatedAt: 1_700_000_000_000,
    });
  });

  it("clamps idleMs to the [5s, 30min] range", async () => {
    const { loadAutoMemoryConfig } = await import("./auto-config");
    const { autoMemoryConfigPath } = await import("./paths");
    await writeFile(autoMemoryConfigPath(), JSON.stringify({ idleMs: 100 }), "utf-8");
    expect((await loadAutoMemoryConfig()).idleMs).toBe(5_000);
    await writeFile(autoMemoryConfigPath(), JSON.stringify({ idleMs: 99_999_999 }), "utf-8");
    expect((await loadAutoMemoryConfig()).idleMs).toBe(30 * 60_000);
  });

  it("AUTO_GLOBAL_MEMORY=0 forces enabled false even when disk says true", async () => {
    process.env.AUTO_GLOBAL_MEMORY = "0";
    const { loadAutoMemoryConfig } = await import("./auto-config");
    const { autoMemoryConfigPath } = await import("./paths");
    await writeFile(autoMemoryConfigPath(), JSON.stringify({ enabled: true }), "utf-8");
    expect((await loadAutoMemoryConfig()).enabled).toBe(false);
  });

  it("recovers from malformed JSON", async () => {
    const { loadAutoMemoryConfig } = await import("./auto-config");
    const { autoMemoryConfigPath } = await import("./paths");
    await writeFile(autoMemoryConfigPath(), "{not json", "utf-8");
    const c = await loadAutoMemoryConfig();
    expect(c.enabled).toBe(true); // back to defaults
  });
});

describe("updateAutoMemoryConfig", () => {
  it("merges patches into the existing config", async () => {
    const { updateAutoMemoryConfig, loadAutoMemoryConfig } = await import("./auto-config");
    await updateAutoMemoryConfig({ enabled: false });
    expect((await loadAutoMemoryConfig()).enabled).toBe(false);
    expect((await loadAutoMemoryConfig()).idleMs).toBe(60_000); // unchanged
  });

  it("preserves unset fields", async () => {
    const { updateAutoMemoryConfig } = await import("./auto-config");
    await updateAutoMemoryConfig({ lastConsolidatedAt: 12345 });
    const next = await updateAutoMemoryConfig({ enabled: false });
    expect(next.lastConsolidatedAt).toBe(12345);
  });

  it("writes valid JSON to disk", async () => {
    const { updateAutoMemoryConfig } = await import("./auto-config");
    const { autoMemoryConfigPath } = await import("./paths");
    await updateAutoMemoryConfig({ idleMs: 90_000 });
    const raw = await readFile(autoMemoryConfigPath(), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.idleMs).toBe(90_000);
  });

  it("clamps out-of-range idleMs in patches", async () => {
    const { updateAutoMemoryConfig } = await import("./auto-config");
    const next = await updateAutoMemoryConfig({ idleMs: 50 });
    expect(next.idleMs).toBe(5_000);
  });
});
