import { describe, expect, it } from "vitest";
import { formatResetsIn, toMillis } from "./format-relative-time";

describe("toMillis", () => {
  it("treats small numbers as seconds", () => {
    expect(toMillis(1_700_000_000)).toBe(1_700_000_000_000);
  });

  it("treats big numbers as milliseconds", () => {
    expect(toMillis(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it("returns null for non-positive / invalid input", () => {
    expect(toMillis(0)).toBeNull();
    expect(toMillis(-1)).toBeNull();
    expect(toMillis(null)).toBeNull();
    expect(toMillis(undefined)).toBeNull();
    expect(toMillis(Number.NaN)).toBeNull();
  });
});

describe("formatResetsIn", () => {
  const now = 1_700_000_000_000;

  it("returns — when the timestamp is missing", () => {
    expect(formatResetsIn(null, now)).toBe("—");
    expect(formatResetsIn(undefined, now)).toBe("—");
  });

  it("returns 'now' for past or near timestamps", () => {
    expect(formatResetsIn(now - 1_000, now)).toBe("now");
    expect(formatResetsIn(now + 30_000, now)).toBe("now"); // under 60s
  });

  it("minutes only, under an hour", () => {
    expect(formatResetsIn(now + 12 * 60_000, now)).toBe("12m");
  });

  it("hours + minutes, under a day", () => {
    const in2h14m = now + (2 * 60 + 14) * 60_000;
    expect(formatResetsIn(in2h14m, now)).toBe("2h 14m");
  });

  it("days + hours, over a day", () => {
    const in5d8h = now + (5 * 24 + 8) * 60 * 60_000;
    expect(formatResetsIn(in5d8h, now)).toBe("5d 8h");
  });

  it("handles the 59m edge without advancing to 1h", () => {
    expect(formatResetsIn(now + 59 * 60_000, now)).toBe("59m");
  });

  it("handles the 23h 59m edge without advancing to 1d", () => {
    const in23h59m = now + (23 * 60 + 59) * 60_000;
    expect(formatResetsIn(in23h59m, now)).toBe("23h 59m");
  });
});
