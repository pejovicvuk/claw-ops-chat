import { describe, expect, it } from "vitest";
import { computeCost, formatCost, normalizeModelId, ratesFor } from "./model-pricing";

describe("normalizeModelId", () => {
  it("strips trailing 8-digit date suffixes", () => {
    expect(normalizeModelId("claude-opus-4-7-20260301")).toBe("claude-opus-4-7");
    expect(normalizeModelId("claude-3-5-sonnet-20241022")).toBe("claude-3-5-sonnet");
  });

  it("leaves ids without a date untouched", () => {
    expect(normalizeModelId("claude-opus-4-7")).toBe("claude-opus-4-7");
  });

  it("strips provider suffixes after @", () => {
    expect(normalizeModelId("claude-opus-4-7@bedrock")).toBe("claude-opus-4-7");
  });
});

describe("ratesFor", () => {
  it("returns a rates entry for known models", () => {
    const rates = ratesFor("claude-opus-4-7-20260301");
    expect(rates).not.toBeNull();
    expect(rates?.label).toBe("Opus 4.7");
    expect(rates?.input).toBe(15);
  });

  it("returns null for unknown models", () => {
    expect(ratesFor("gpt-4")).toBeNull();
    expect(ratesFor(null)).toBeNull();
    expect(ratesFor(undefined)).toBeNull();
    expect(ratesFor("")).toBeNull();
  });
});

describe("computeCost", () => {
  it("computes cost from the four token classes", () => {
    // 1M input @ $15 + 1M output @ $75 + 1M cacheRead @ $1.5 + 1M cacheCreate @ $18.75
    const cost = computeCost({
      model: "claude-opus-4-7",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheCreateTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(110.25, 2);
  });

  it("returns null for unknown models", () => {
    expect(
      computeCost({
        model: "unknown-model",
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      }),
    ).toBeNull();
  });

  it("handles tiny token counts without underflow", () => {
    const cost = computeCost({
      model: "claude-haiku-4-5",
      inputTokens: 500,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    });
    // 500*1 + 100*5 = 1000 micro-USD = $0.001
    expect(cost).toBeCloseTo(0.001, 6);
  });
});

describe("formatCost", () => {
  it("shows em-dash for null", () => {
    expect(formatCost(null)).toBe("—");
  });

  it("shows $0.00 for zero exactly", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("shows 4 decimals for sub-cent costs", () => {
    expect(formatCost(0.0012)).toBe("$0.0012");
  });

  it("shows 3 decimals for sub-dollar costs", () => {
    expect(formatCost(0.142)).toBe("$0.142");
  });

  it("shows 2 decimals for dollar-plus costs", () => {
    expect(formatCost(12.345)).toBe("$12.35");
  });
});
