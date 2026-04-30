import { describe, expect, it } from "vitest";
import { formatElapsed, formatTimeUntil } from "./format-time";

describe("formatElapsed", () => {
  it("clamps non-positive or non-finite inputs to 0s", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(-1)).toBe("0s");
    expect(formatElapsed(NaN)).toBe("0s");
    expect(formatElapsed(Infinity)).toBe("0s");
  });

  it("renders sub-minute deltas as bare seconds", () => {
    expect(formatElapsed(1_000)).toBe("1s");
    expect(formatElapsed(45_000)).toBe("45s");
  });

  it("renders sub-hour deltas as minutes + seconds", () => {
    // 5m 23s exactly
    expect(formatElapsed(5 * 60_000 + 23_000)).toBe("5m 23s");
    // exactly 1m
    expect(formatElapsed(60_000)).toBe("1m 0s");
  });

  it("renders sub-day deltas as hours + minutes (drops seconds)", () => {
    // 2h 14m 30s → "2h 14m" (seconds intentionally dropped at this scale)
    expect(formatElapsed(2 * 3_600_000 + 14 * 60_000 + 30_000)).toBe("2h 14m");
  });

  it("renders day-plus deltas as days + hours", () => {
    expect(formatElapsed(86_400_000)).toBe("1d 0h");
    expect(formatElapsed(86_400_000 + 4 * 3_600_000)).toBe("1d 4h");
  });
});

describe("formatTimeUntil", () => {
  it("returns 'due now' for past or current timestamps", () => {
    expect(formatTimeUntil(Date.now() - 1_000)).toBe("due now");
  });

  it("formats minute-scale futures", () => {
    const target = Date.now() + 5 * 60_000 + 1_000;
    expect(formatTimeUntil(target)).toBe("in 5m");
  });
});
