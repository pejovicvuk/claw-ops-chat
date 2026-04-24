import { mkdtempSync, rmSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyRateLimitEvent, loadRateLimits, __resetForTests } from "./account-rate-limits";

let workHome = "";
const originalHome = process.env.HOME;

beforeEach(() => {
  // Redirect `homedir()` to a temp dir so each test gets a clean slate.
  workHome = mkdtempSync(join(tmpdir(), "account-rate-limits-"));
  process.env.HOME = workHome;
  __resetForTests();
});

afterEach(() => {
  if (workHome) rmSync(workHome, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  __resetForTests();
});

describe("loadRateLimits", () => {
  it("returns empty cache when no file exists", async () => {
    const cache = await loadRateLimits();
    expect(cache.updatedAt).toBeNull();
    expect(cache.windows).toEqual({});
  });

  it("reads a previously-written cache back", async () => {
    await applyRateLimitEvent({
      rateLimitType: "five_hour",
      status: "allowed",
      utilization: 0.235,
      resetsAt: 1_700_000_000_000,
    });
    __resetForTests();
    const cache = await loadRateLimits();
    expect(cache.windows.five_hour?.utilization).toBeCloseTo(0.235);
  });
});

describe("applyRateLimitEvent", () => {
  it("stores a new window keyed by type", async () => {
    const cache = await applyRateLimitEvent({
      rateLimitType: "five_hour",
      status: "allowed",
      utilization: 0.235,
      resetsAt: 1_700_000_000_000,
    });
    expect(cache.windows.five_hour).toMatchObject({
      status: "allowed",
      utilization: 0.235,
      resetsAt: 1_700_000_000_000,
    });
    expect(cache.updatedAt).toBeTypeOf("number");
  });

  it("merges independent events without clobbering existing windows", async () => {
    await applyRateLimitEvent({
      rateLimitType: "five_hour",
      status: "allowed",
      utilization: 0.2,
      resetsAt: 1_700_000_000_000,
    });
    const cache = await applyRateLimitEvent({
      rateLimitType: "seven_day",
      status: "allowed_warning",
      utilization: 0.85,
      resetsAt: 1_700_500_000_000,
    });
    expect(Object.keys(cache.windows).sort()).toEqual(["five_hour", "seven_day"]);
    expect(cache.windows.five_hour?.utilization).toBeCloseTo(0.2);
    expect(cache.windows.seven_day?.utilization).toBeCloseTo(0.85);
    expect(cache.windows.seven_day?.status).toBe("allowed_warning");
  });

  it("normalises resetsAt from seconds to ms", async () => {
    const cache = await applyRateLimitEvent({
      rateLimitType: "five_hour",
      status: "allowed",
      utilization: 0.1,
      resetsAt: 1_700_000_000, // seconds
    });
    expect(cache.windows.five_hour?.resetsAt).toBe(1_700_000_000_000);
  });

  it("ignores events without a rateLimitType", async () => {
    const before = await loadRateLimits();
    const after = await applyRateLimitEvent({
      status: "allowed",
      utilization: 0.5,
    });
    expect(after).toEqual(before);
  });

  it("writes atomically — no stray .tmp file left behind", async () => {
    await applyRateLimitEvent({
      rateLimitType: "five_hour",
      status: "allowed",
      utilization: 0.1,
      resetsAt: 1_700_000_000_000,
    });
    const { readdir } = await import("fs/promises");
    const entries = await readdir(join(workHome, ".claude"));
    expect(entries).toContain("claw-account-rate-limits.json");
    expect(entries.some((e) => e.endsWith(".tmp"))).toBe(false);
  });

  it("survives a malformed cache file and overwrites it cleanly", async () => {
    const { writeFile, mkdir } = await import("fs/promises");
    await mkdir(join(workHome, ".claude"), { recursive: true });
    await writeFile(
      join(workHome, ".claude", "claw-account-rate-limits.json"),
      "not valid json{",
      "utf-8",
    );
    __resetForTests();
    const cache = await applyRateLimitEvent({
      rateLimitType: "five_hour",
      status: "allowed",
      utilization: 0.3,
      resetsAt: 1_700_000_000_000,
    });
    expect(cache.windows.five_hour?.utilization).toBeCloseTo(0.3);
    // File should now be valid JSON.
    const raw = await readFile(join(workHome, ".claude", "claw-account-rate-limits.json"), "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
