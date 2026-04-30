import { describe, it, expect } from "vitest";
import {
  snapshotFromAssistantUsage,
  extractContextWindow,
  DEFAULT_CONTEXT_WINDOW,
} from "./context-usage";

describe("snapshotFromAssistantUsage", () => {
  it("computes used = input + cache_read + cache_create (excluding output)", () => {
    const snap = snapshotFromAssistantUsage({
      input_tokens: 100,
      output_tokens: 999, // must NOT contribute to `used`
      cache_read_input_tokens: 200_000,
      cache_creation_input_tokens: 5_000,
    });
    expect(snap.used).toBe(205_100);
    // Output is tracked separately for cost display, just not summed into `used`.
    expect(snap.outputTokens).toBe(999);
  });

  it("defaults max to 1M when no contextWindow is provided", () => {
    const snap = snapshotFromAssistantUsage({ input_tokens: 1000 });
    expect(snap.max).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(snap.max).toBe(1_000_000);
  });

  it("uses the provided contextWindow as max", () => {
    const snap = snapshotFromAssistantUsage({ input_tokens: 1000 }, null, 200_000);
    expect(snap.max).toBe(200_000);
  });

  it("falls back to DEFAULT_CONTEXT_WINDOW when contextWindow is 0 or negative", () => {
    expect(snapshotFromAssistantUsage({ input_tokens: 1 }, null, 0).max).toBe(
      DEFAULT_CONTEXT_WINDOW,
    );
    expect(snapshotFromAssistantUsage({ input_tokens: 1 }, null, -42).max).toBe(
      DEFAULT_CONTEXT_WINDOW,
    );
  });

  it("computes percentage rounded to nearest integer", () => {
    const snap = snapshotFromAssistantUsage({ input_tokens: 250_000 }, null, 1_000_000);
    expect(snap.percentage).toBe(25);
  });

  it("caps percentage at 100 even when used exceeds the cap", () => {
    const snap = snapshotFromAssistantUsage({ input_tokens: 5_000_000 }, null, 1_000_000);
    expect(snap.percentage).toBe(100);
  });

  it("returns zeros for an empty usage object", () => {
    const snap = snapshotFromAssistantUsage({});
    expect(snap.used).toBe(0);
    expect(snap.percentage).toBe(0);
    expect(snap.inputTokens).toBe(0);
    expect(snap.outputTokens).toBe(0);
    expect(snap.cacheReadTokens).toBe(0);
    expect(snap.cacheCreateTokens).toBe(0);
  });

  it("preserves the model id", () => {
    const snap = snapshotFromAssistantUsage({ input_tokens: 1 }, "claude-sonnet-4-5-20250929");
    expect(snap.model).toBe("claude-sonnet-4-5-20250929");
  });

  it("model defaults to null", () => {
    expect(snapshotFromAssistantUsage({ input_tokens: 1 }).model).toBeNull();
  });

  /**
   * Regression test for the "1253% on a brand-new chat" bug. The cause
   * was using `result.modelUsage` as the source of "used" — that field
   * sums tokens across every streamed assistant chunk in the turn, so
   * after a few cached-prompt turns it explodes past the window.
   *
   * The fix: take only the LATEST per-message snapshot. This test
   * proves the function returns the latest value and never the sum.
   */
  it("REGRESSION: a 5-turn synthetic session reports the latest snapshot, not the cumulative sum", () => {
    // Each turn is one assistant message with growing cache_read (the
    // typical Claude Code pattern: cache hits accumulate across turns).
    const turns: Array<Parameters<typeof snapshotFromAssistantUsage>[0]> = [
      { input_tokens: 5, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 100 },
      { input_tokens: 5, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 200 },
      { input_tokens: 5, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 500 },
      { input_tokens: 5, cache_read_input_tokens: 200_000, cache_creation_input_tokens: 1_000 },
      { input_tokens: 5, cache_read_input_tokens: 390_000, cache_creation_input_tokens: 1_500 },
    ];

    const snapshots = turns.map((u) => snapshotFromAssistantUsage(u));
    const latest = snapshots[snapshots.length - 1]!;

    // Latest snapshot — the right answer.
    expect(latest.used).toBe(391_505); // 5 + 390_000 + 1_500
    expect(latest.percentage).toBe(39);

    // The wrong calculation would sum across turns: 10_105 + 50_205 +
    // 100_505 + 201_005 + 391_505 = 753_325. We must NOT report that.
    const wrongCumulative = snapshots.reduce((acc, s) => acc + s.used, 0);
    expect(wrongCumulative).toBe(753_325); // sanity: the bug's value
    expect(latest.used).not.toBe(wrongCumulative);
    expect(latest.used).toBeLessThan(wrongCumulative);
  });
});

describe("extractContextWindow", () => {
  it("returns null on null/undefined", () => {
    expect(extractContextWindow(null)).toBeNull();
    expect(extractContextWindow(undefined)).toBeNull();
  });

  it("returns null on non-objects", () => {
    expect(extractContextWindow("string")).toBeNull();
    expect(extractContextWindow(42)).toBeNull();
    expect(extractContextWindow(true)).toBeNull();
  });

  it("returns null on empty object", () => {
    expect(extractContextWindow({})).toBeNull();
  });

  it("extracts the contextWindow of the first model entry", () => {
    const result = extractContextWindow({
      "claude-sonnet-4-5-20250929": {
        contextWindow: 1_000_000,
        // These cumulative fields must be ignored — extracting them
        // here is the bug we're guarding against.
        inputTokens: 999_999,
        cacheReadInputTokens: 999_999,
        cacheCreationInputTokens: 999_999,
      },
    });
    expect(result).toEqual({
      model: "claude-sonnet-4-5-20250929",
      contextWindow: 1_000_000,
    });
  });

  it("returns null when contextWindow is missing", () => {
    expect(extractContextWindow({ "claude-x": { inputTokens: 100 } })).toBeNull();
  });

  it("returns null when contextWindow is zero, negative, or non-finite", () => {
    expect(extractContextWindow({ "claude-x": { contextWindow: 0 } })).toBeNull();
    expect(extractContextWindow({ "claude-x": { contextWindow: -1 } })).toBeNull();
    expect(extractContextWindow({ "claude-x": { contextWindow: NaN } })).toBeNull();
    expect(extractContextWindow({ "claude-x": { contextWindow: Infinity } })).toBeNull();
  });

  it("returns null when the first entry's value is not an object", () => {
    expect(extractContextWindow({ "claude-x": null })).toBeNull();
    expect(extractContextWindow({ "claude-x": "garbage" })).toBeNull();
  });
});
