import { describe, expect, it } from "vitest";
import { __test__ } from "./docker-prune";

const { clampIntervalDays, formatBytesShort, DEFAULT_CONFIG } = __test__;

describe("clampIntervalDays", () => {
  it("returns a finite integer in the default range for a valid input", () => {
    expect(clampIntervalDays(7)).toBe(7);
    expect(clampIntervalDays(1)).toBe(1);
    expect(clampIntervalDays(365)).toBe(365);
  });

  it("clamps values below the minimum to 1 day", () => {
    expect(clampIntervalDays(0)).toBe(1);
    expect(clampIntervalDays(-5)).toBe(1);
  });

  it("clamps values above the maximum to 365 days", () => {
    expect(clampIntervalDays(1000)).toBe(365);
  });

  it("falls back to the default when the input is non-finite", () => {
    expect(clampIntervalDays(Number.NaN)).toBe(DEFAULT_CONFIG.intervalDays);
    expect(clampIntervalDays(Number.POSITIVE_INFINITY)).toBe(DEFAULT_CONFIG.intervalDays);
  });

  it("floors fractional inputs", () => {
    expect(clampIntervalDays(7.9)).toBe(7);
    expect(clampIntervalDays(1.5)).toBe(1);
  });
});

describe("formatBytesShort", () => {
  it("formats sub-KB values as bytes", () => {
    expect(formatBytesShort(0)).toBe("0 B");
    expect(formatBytesShort(512)).toBe("512 B");
  });

  it("formats KB / MB / GB at the right boundary", () => {
    expect(formatBytesShort(2048)).toBe("2.0 KB");
    expect(formatBytesShort(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytesShort(2 * 1024 * 1024 * 1024)).toBe("2.00 GB");
  });
});

describe("DEFAULT_CONFIG", () => {
  it("ships with prune enabled on a 7-day interval", () => {
    expect(DEFAULT_CONFIG.enabled).toBe(true);
    expect(DEFAULT_CONFIG.intervalDays).toBe(7);
    expect(DEFAULT_CONFIG.lastRunAt).toBeNull();
    expect(DEFAULT_CONFIG.lastBytesFreed).toBe(0);
    expect(DEFAULT_CONFIG.lastError).toBeNull();
  });
});
