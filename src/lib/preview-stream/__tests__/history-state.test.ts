import { describe, expect, it } from "vitest";
import { HistoryStateDeduper, computeHistoryState, type NavigationHistory } from "../history-state";

const hist = (currentIndex: number, length: number): NavigationHistory => ({
  currentIndex,
  entries: Array.from({ length }, (_, i) => ({ id: i, url: `https://x/${i}` })),
});

describe("computeHistoryState", () => {
  it("disables both at root with no history", () => {
    expect(computeHistoryState(hist(0, 1))).toEqual({
      canGoBack: false,
      canGoForward: false,
    });
  });

  it("enables canGoBack when currentIndex > 0", () => {
    expect(computeHistoryState(hist(2, 5))).toMatchObject({ canGoBack: true });
  });

  it("enables canGoForward when there are entries past currentIndex", () => {
    expect(computeHistoryState(hist(2, 5))).toMatchObject({ canGoForward: true });
  });

  it("disables canGoForward when currentIndex is the last entry", () => {
    expect(computeHistoryState(hist(4, 5))).toEqual({
      canGoBack: true,
      canGoForward: false,
    });
  });

  it("disables canGoBack at the first entry of a multi-entry history", () => {
    expect(computeHistoryState(hist(0, 5))).toEqual({
      canGoBack: false,
      canGoForward: true,
    });
  });
});

describe("HistoryStateDeduper", () => {
  it("emits the first state regardless of values", () => {
    const dedup = new HistoryStateDeduper();
    expect(dedup.shouldEmit({ canGoBack: false, canGoForward: false })).toEqual({
      canGoBack: false,
      canGoForward: false,
    });
  });

  it("returns null for an identical follow-up state", () => {
    const dedup = new HistoryStateDeduper();
    dedup.shouldEmit({ canGoBack: true, canGoForward: false });
    expect(dedup.shouldEmit({ canGoBack: true, canGoForward: false })).toBeNull();
  });

  it("emits when canGoBack flips", () => {
    const dedup = new HistoryStateDeduper();
    dedup.shouldEmit({ canGoBack: true, canGoForward: false });
    expect(dedup.shouldEmit({ canGoBack: false, canGoForward: false })).toEqual({
      canGoBack: false,
      canGoForward: false,
    });
  });

  it("emits when canGoForward flips even if canGoBack is unchanged", () => {
    const dedup = new HistoryStateDeduper();
    dedup.shouldEmit({ canGoBack: true, canGoForward: false });
    expect(dedup.shouldEmit({ canGoBack: true, canGoForward: true })).toEqual({
      canGoBack: true,
      canGoForward: true,
    });
  });

  it("multiple identical emits in a row only fire once", () => {
    const dedup = new HistoryStateDeduper();
    dedup.shouldEmit({ canGoBack: true, canGoForward: true });
    expect(dedup.shouldEmit({ canGoBack: true, canGoForward: true })).toBeNull();
    expect(dedup.shouldEmit({ canGoBack: true, canGoForward: true })).toBeNull();
  });
});
