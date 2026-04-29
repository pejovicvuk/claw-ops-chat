// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CANVAS_SCHEMA_VERSION,
  emptyCanvasState,
  type CanvasState,
} from "@/components/canvas/canvas-types";
import { clearCanvas, loadCanvas, loadCanvasOrEmpty, saveCanvas } from "./canvas-store";

describe("canvas-store", () => {
  beforeEach(() => {
    // jsdom provides a real localStorage; clear between tests.
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns null when nothing is stored", () => {
    expect(loadCanvas("a/b")).toBeNull();
  });

  it("save + load round-trips", () => {
    const state: CanvasState = {
      ...emptyCanvasState(),
      windows: [
        {
          id: "w1",
          page: 0,
          geometry: { x: 10, y: 20, w: 520, h: 580 },
          state: { kind: "chat", sessionId: "s1" },
        },
      ],
      currentPage: 0,
      focusOrder: ["w1"],
    };
    saveCanvas("alpha/bravo", state);
    const loaded = loadCanvas("alpha/bravo");
    expect(loaded?.windows).toHaveLength(1);
    expect(loaded?.windows[0].id).toBe("w1");
  });

  it("loadCanvasOrEmpty returns an empty state when nothing is stored", () => {
    const state = loadCanvasOrEmpty("nope");
    expect(state.windows).toEqual([]);
    expect(state.currentPage).toBe(0);
    expect(state.focusOrder).toEqual([]);
    expect(state.version).toBe(CANVAS_SCHEMA_VERSION);
  });

  it("clearCanvas removes a single item without touching others", () => {
    saveCanvas("a", emptyCanvasState());
    saveCanvas("b", emptyCanvasState());
    clearCanvas("a");
    expect(loadCanvas("a")).toBeNull();
    expect(loadCanvas("b")).not.toBeNull();
  });

  it("clearCanvas is a no-op when the key is missing", () => {
    saveCanvas("a", emptyCanvasState());
    expect(() => clearCanvas("ghost")).not.toThrow();
    expect(loadCanvas("a")).not.toBeNull();
  });

  it("touch timestamp advances on each save", () => {
    saveCanvas("k", emptyCanvasState());
    const first = loadCanvas("k")!.touched;
    vi.useFakeTimers();
    vi.setSystemTime(first + 5_000);
    saveCanvas("k", emptyCanvasState());
    const second = loadCanvas("k")!.touched;
    vi.useRealTimers();
    expect(second).toBeGreaterThan(first);
  });

  it("rejects payloads from older schema versions", () => {
    localStorage.setItem(
      "claw-item-canvas:v1",
      JSON.stringify({
        ghost: {
          version: CANVAS_SCHEMA_VERSION - 1,
          windows: [],
          currentPage: 0,
          focusOrder: [],
          touched: Date.now(),
        },
      }),
    );
    expect(loadCanvas("ghost")).toBeNull();
  });

  it("rejects malformed JSON", () => {
    localStorage.setItem("claw-item-canvas:v1", "{ not json");
    expect(loadCanvas("anything")).toBeNull();
  });

  it("rejects entries missing required arrays", () => {
    localStorage.setItem(
      "claw-item-canvas:v1",
      JSON.stringify({
        broken: { version: CANVAS_SCHEMA_VERSION, currentPage: 0, touched: Date.now() },
      }),
    );
    expect(loadCanvas("broken")).toBeNull();
  });

  it("LRU-evicts least-recently-touched entries when over MAX_ENTRIES", () => {
    // Stuff 110 entries with monotonically increasing `touched` so the
    // last 10 (oldest by save order) get dropped.
    vi.useFakeTimers();
    for (let i = 0; i < 110; i++) {
      vi.setSystemTime(1_000 + i * 1_000);
      saveCanvas(`k${i}`, emptyCanvasState());
    }
    vi.useRealTimers();
    // Newest should survive, oldest should be evicted.
    expect(loadCanvas("k109")).not.toBeNull();
    expect(loadCanvas("k0")).toBeNull();
  });
});
