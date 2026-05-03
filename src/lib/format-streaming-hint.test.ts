import { describe, expect, it } from "vitest";
import { formatElapsed, formatStreamingHint, formatTokens } from "./format-streaming-hint";

describe("formatElapsed", () => {
  it("renders sub-second durations as <1s (no flicker between 0s and 1s)", () => {
    expect(formatElapsed(0)).toBe("<1s");
    expect(formatElapsed(650)).toBe("<1s");
    expect(formatElapsed(999)).toBe("<1s");
  });

  it("renders whole seconds without minutes for under a minute", () => {
    expect(formatElapsed(1000)).toBe("1s");
    expect(formatElapsed(12_500)).toBe("12s");
    expect(formatElapsed(59_999)).toBe("59s");
  });

  it("rolls over to minutes at 60s", () => {
    expect(formatElapsed(60_000)).toBe("1m 0s");
    expect(formatElapsed(75_000)).toBe("1m 15s");
    expect(formatElapsed(125_500)).toBe("2m 5s");
  });

  it("keeps minute-second format past an hour rather than introducing 'h'", () => {
    expect(formatElapsed(3_725_000)).toBe("62m 5s");
  });

  it("treats negative or NaN input as <1s rather than throwing", () => {
    expect(formatElapsed(-100)).toBe("<1s");
    expect(formatElapsed(Number.NaN)).toBe("<1s");
    expect(formatElapsed(Number.POSITIVE_INFINITY)).toBe("<1s");
  });
});

describe("formatTokens", () => {
  it("renders small counts as plain numbers", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(487)).toBe("487");
  });

  it("uses thousands separators for readability at scale", () => {
    expect(formatTokens(12_300)).toBe("12,300");
    expect(formatTokens(1_234_567)).toBe("1,234,567");
  });

  it("rounds fractional inputs", () => {
    expect(formatTokens(487.7)).toBe("488");
  });

  it("returns '0' for missing / invalid input rather than throwing", () => {
    expect(formatTokens(undefined)).toBe("0");
    expect(formatTokens(null)).toBe("0");
    expect(formatTokens(Number.NaN)).toBe("0");
    expect(formatTokens(-5)).toBe("0");
  });
});

describe("formatStreamingHint", () => {
  it("returns elapsed-only when no token data is available yet", () => {
    expect(formatStreamingHint({ elapsedMs: 8_000 })).toBe("8s");
  });

  it("appends output tokens with the ↓ arrow when present", () => {
    expect(formatStreamingHint({ elapsedMs: 12_000, outputTokens: 487 })).toBe(
      "12s · ↓ 487 tokens",
    );
  });

  it("appends input tokens with the ↑ arrow when both are present", () => {
    expect(
      formatStreamingHint({
        elapsedMs: 12_000,
        outputTokens: 487,
        inputTokens: 12_300,
      }),
    ).toBe("12s · ↓ 487 tokens · ↑ 12,300 in");
  });

  it("omits zero-token fields rather than printing '0 tokens'", () => {
    // A snapshot can land with input>0 and output==0 (or vice versa) on
    // tool-result chunks. Suppressing zero keeps the hint terse and
    // matches the terminal's behaviour.
    expect(
      formatStreamingHint({
        elapsedMs: 5_000,
        outputTokens: 0,
        inputTokens: 1_500,
      }),
    ).toBe("5s · ↑ 1,500 in");
    expect(formatStreamingHint({ elapsedMs: 5_000, outputTokens: 0, inputTokens: 0 })).toBe("5s");
  });
});
