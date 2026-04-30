import { describe, it, expect } from "vitest";
import {
  moreRestrictive,
  pickWeeklyWindow,
  pickFiveHourWindow,
  utilizationToPercent,
} from "./rate-limits-window";
import type { RateLimitWindow, RateLimitsCache } from "./account-rate-limits";

const w = (
  status: RateLimitWindow["status"],
  utilization?: number,
  resetsAt?: number,
): RateLimitWindow => ({
  status,
  ...(utilization !== undefined ? { utilization } : {}),
  ...(resetsAt !== undefined ? { resetsAt } : {}),
});

describe("moreRestrictive", () => {
  it("returns the non-null one when only one is present", () => {
    expect(moreRestrictive(null, w("allowed", 0.1))).toEqual(w("allowed", 0.1));
    expect(moreRestrictive(w("allowed", 0.1), null)).toEqual(w("allowed", 0.1));
    expect(moreRestrictive(null, null)).toBeNull();
    expect(moreRestrictive(undefined, undefined)).toBeNull();
  });

  it("rejected always wins over allowed_warning and allowed", () => {
    expect(moreRestrictive(w("rejected"), w("allowed_warning", 0.99))).toEqual(w("rejected"));
    expect(moreRestrictive(w("allowed", 0.1), w("rejected"))).toEqual(w("rejected"));
  });

  it("allowed_warning wins over allowed regardless of utilization", () => {
    expect(moreRestrictive(w("allowed_warning", 0.5), w("allowed", 0.99))).toEqual(
      w("allowed_warning", 0.5),
    );
  });

  it("within the same status, higher utilization wins", () => {
    expect(moreRestrictive(w("allowed", 0.3), w("allowed", 0.7))).toEqual(w("allowed", 0.7));
    expect(moreRestrictive(w("allowed_warning", 0.85), w("allowed_warning", 0.92))).toEqual(
      w("allowed_warning", 0.92),
    );
  });

  it("treats missing utilization as -1 (lowest), so present wins", () => {
    expect(moreRestrictive(w("allowed"), w("allowed", 0.01))).toEqual(w("allowed", 0.01));
  });

  it("breaks ties on utilization by closer resetsAt", () => {
    const farther = w("allowed", 0.5, 2_000_000_000_000);
    const sooner = w("allowed", 0.5, 1_700_000_000_000);
    expect(moreRestrictive(farther, sooner)).toEqual(sooner);
  });
});

describe("pickWeeklyWindow", () => {
  it("returns null when the cache has no weekly entries", () => {
    expect(pickWeeklyWindow(null)).toEqual({ window: null, key: null });
    expect(pickWeeklyWindow(undefined)).toEqual({ window: null, key: null });
    expect(pickWeeklyWindow({ updatedAt: 1, windows: {} })).toEqual({ window: null, key: null });
    expect(
      pickWeeklyWindow({
        updatedAt: 1,
        windows: { five_hour: w("allowed", 0.2) },
      }),
    ).toEqual({ window: null, key: null });
  });

  it("returns the only weekly entry when just one is present", () => {
    const cache: RateLimitsCache = {
      updatedAt: 1,
      windows: { seven_day: w("allowed", 0.42) },
    };
    const result = pickWeeklyWindow(cache);
    expect(result.key).toBe("seven_day");
    expect(result.window?.utilization).toBeCloseTo(0.42);
  });

  it("picks the most-restrictive across seven_day / seven_day_opus / seven_day_sonnet", () => {
    const cache: RateLimitsCache = {
      updatedAt: 1,
      windows: {
        seven_day: w("allowed", 0.3),
        seven_day_sonnet: w("allowed", 0.6), // highest utilization but allowed
        seven_day_opus: w("allowed_warning", 0.55), // warning beats allowed even at lower util
      },
    };
    const result = pickWeeklyWindow(cache);
    expect(result.key).toBe("seven_day_opus");
    expect(result.window?.status).toBe("allowed_warning");
  });

  it("rejected beats warning beats allowed regardless of which key", () => {
    const cache: RateLimitsCache = {
      updatedAt: 1,
      windows: {
        seven_day: w("rejected"),
        seven_day_opus: w("allowed_warning", 0.95),
        seven_day_sonnet: w("allowed", 0.99),
      },
    };
    expect(pickWeeklyWindow(cache).key).toBe("seven_day");
  });

  it("ignores non-weekly entries", () => {
    const cache: RateLimitsCache = {
      updatedAt: 1,
      windows: {
        five_hour: w("allowed_warning", 0.95),
        overage: w("rejected"),
        seven_day: w("allowed", 0.3),
      },
    };
    const result = pickWeeklyWindow(cache);
    expect(result.key).toBe("seven_day");
    expect(result.window?.utilization).toBeCloseTo(0.3);
  });
});

describe("pickFiveHourWindow", () => {
  it("returns null when missing", () => {
    expect(pickFiveHourWindow(null)).toEqual({ window: null, key: null });
    expect(pickFiveHourWindow({ updatedAt: 1, windows: { seven_day: w("allowed", 0.1) } })).toEqual(
      { window: null, key: null },
    );
  });

  it("passes through the five_hour entry", () => {
    const cache: RateLimitsCache = {
      updatedAt: 1,
      windows: { five_hour: w("allowed", 0.42, 1_700_000_000_000) },
    };
    expect(pickFiveHourWindow(cache)).toEqual({
      window: w("allowed", 0.42, 1_700_000_000_000),
      key: "five_hour",
    });
  });
});

describe("utilizationToPercent", () => {
  it("converts 0..1 to 0..100", () => {
    expect(utilizationToPercent(0)).toBe(0);
    expect(utilizationToPercent(0.5)).toBe(50);
    expect(utilizationToPercent(1)).toBe(100);
    expect(utilizationToPercent(0.234)).toBe(23);
  });

  it("clamps out-of-range values", () => {
    expect(utilizationToPercent(-0.5)).toBe(0);
    expect(utilizationToPercent(1.5)).toBe(100);
  });

  it("returns null for missing or non-finite", () => {
    expect(utilizationToPercent(undefined)).toBeNull();
    expect(utilizationToPercent(null)).toBeNull();
    expect(utilizationToPercent(NaN)).toBeNull();
    expect(utilizationToPercent(Infinity)).toBeNull();
  });
});
