import { describe, expect, it } from "vitest";
import { humanizeCron, nextRunTimes } from "./cron-humanize";

describe("humanizeCron", () => {
  it("returns a human-readable description for a valid expression", () => {
    expect(humanizeCron("0 6 * * *")).toMatch(/6:00 AM|06:00/i);
  });

  it("returns 'Invalid cron expression' for garbage input", () => {
    expect(humanizeCron("definitely not a cron")).toMatch(/invalid/i);
  });
});

describe("nextRunTimes", () => {
  it("returns N future ISO timestamps for a valid expression", async () => {
    const runs = await nextRunTimes("0 6 * * *", "UTC", 3);
    expect(runs).toHaveLength(3);
    for (const iso of runs) {
      // All entries must parse back to a valid Date in the future.
      expect(Number.isNaN(new Date(iso).getTime())).toBe(false);
      expect(new Date(iso).getTime()).toBeGreaterThan(Date.now() - 60_000);
    }
  });

  it("returns a strictly increasing sequence", async () => {
    const runs = await nextRunTimes("*/5 * * * *", "UTC", 4);
    for (let i = 1; i < runs.length; i++) {
      expect(new Date(runs[i]).getTime()).toBeGreaterThan(new Date(runs[i - 1]).getTime());
    }
  });

  it("returns empty array on invalid expression", async () => {
    const runs = await nextRunTimes("not a cron", "UTC", 3);
    expect(runs).toEqual([]);
  });

  it("respects the requested count", async () => {
    const runs = await nextRunTimes("0 6 * * *", "UTC", 5);
    expect(runs).toHaveLength(5);
  });
});
