import { describe, expect, it } from "vitest";
import {
  EDGE_BAND,
  SNAP_INSET,
  TOP_BAND,
  detectSnapZone,
  type CanvasBounds,
  type OtherWindow,
} from "./snap-zones";

const BOUNDS: CanvasBounds = { width: 1000, height: 800 };

describe("detectSnapZone", () => {
  it("returns null when the pointer is in the dead center", () => {
    expect(detectSnapZone({ x: 500, y: 400 }, BOUNDS)).toBeNull();
  });

  it("returns null when the pointer is outside the canvas", () => {
    expect(detectSnapZone({ x: -5, y: 100 }, BOUNDS)).toBeNull();
    expect(detectSnapZone({ x: 100, y: -5 }, BOUNDS)).toBeNull();
    expect(detectSnapZone({ x: 1100, y: 100 }, BOUNDS)).toBeNull();
    expect(detectSnapZone({ x: 100, y: 900 }, BOUNDS)).toBeNull();
  });

  it("returns null for zero / negative bounds", () => {
    expect(detectSnapZone({ x: 0, y: 0 }, { width: 0, height: 0 })).toBeNull();
    expect(detectSnapZone({ x: 0, y: 0 }, { width: -10, height: 100 })).toBeNull();
  });

  it("top-band maximize wins over top-half when pointer is within TOP_BAND of y=0", () => {
    const r = detectSnapZone({ x: 500, y: TOP_BAND - 1 }, BOUNDS);
    expect(r?.kind).toBe("max");
    expect(r?.geometry).toEqual({
      x: SNAP_INSET,
      y: SNAP_INSET,
      w: BOUNDS.width - 2 * SNAP_INSET,
      h: BOUNDS.height - 2 * SNAP_INSET,
    });
  });

  it("just below the top band but still within edge band triggers top-half", () => {
    const r = detectSnapZone({ x: 500, y: TOP_BAND + 5 }, BOUNDS);
    expect(r?.kind).toBe("top");
    expect(r?.geometry.x).toBe(SNAP_INSET);
    expect(r?.geometry.h).toBe(Math.floor(BOUNDS.height / 2) - SNAP_INSET);
  });

  it("left edge → left half", () => {
    const r = detectSnapZone({ x: EDGE_BAND - 1, y: 400 }, BOUNDS);
    expect(r?.kind).toBe("left");
    expect(r?.geometry).toEqual({
      x: SNAP_INSET,
      y: SNAP_INSET,
      w: Math.floor(BOUNDS.width / 2) - SNAP_INSET,
      h: BOUNDS.height - 2 * SNAP_INSET,
    });
  });

  it("right edge → right half", () => {
    const r = detectSnapZone({ x: BOUNDS.width - 5, y: 400 }, BOUNDS);
    expect(r?.kind).toBe("right");
    const halfW = Math.floor(BOUNDS.width / 2);
    expect(r?.geometry).toEqual({
      x: halfW,
      y: SNAP_INSET,
      w: BOUNDS.width - halfW - SNAP_INSET,
      h: BOUNDS.height - 2 * SNAP_INSET,
    });
  });

  it("bottom edge → bottom half (when not at top band)", () => {
    const r = detectSnapZone({ x: 500, y: BOUNDS.height - 5 }, BOUNDS);
    expect(r?.kind).toBe("bottom");
    const halfH = Math.floor(BOUNDS.height / 2);
    expect(r?.geometry).toEqual({
      x: SNAP_INSET,
      y: halfH,
      w: BOUNDS.width - 2 * SNAP_INSET,
      h: BOUNDS.height - halfH - SNAP_INSET,
    });
  });

  it("top-left corner → tl quarter", () => {
    // Use y=TOP_BAND so we don't hit the max band.
    const r = detectSnapZone({ x: 5, y: TOP_BAND + 5 }, BOUNDS);
    expect(r?.kind).toBe("tl");
    const halfW = Math.floor(BOUNDS.width / 2);
    const halfH = Math.floor(BOUNDS.height / 2);
    expect(r?.geometry).toEqual({
      x: SNAP_INSET,
      y: SNAP_INSET,
      w: halfW - SNAP_INSET,
      h: halfH - SNAP_INSET,
    });
  });

  it("top-right corner → tr quarter", () => {
    const r = detectSnapZone({ x: BOUNDS.width - 5, y: TOP_BAND + 5 }, BOUNDS);
    expect(r?.kind).toBe("tr");
  });

  it("bottom-left corner → bl quarter", () => {
    const r = detectSnapZone({ x: 5, y: BOUNDS.height - 5 }, BOUNDS);
    expect(r?.kind).toBe("bl");
  });

  it("bottom-right corner → br quarter", () => {
    const r = detectSnapZone({ x: BOUNDS.width - 5, y: BOUNDS.height - 5 }, BOUNDS);
    expect(r?.kind).toBe("br");
    const halfW = Math.floor(BOUNDS.width / 2);
    const halfH = Math.floor(BOUNDS.height / 2);
    expect(r?.geometry).toEqual({
      x: halfW,
      y: halfH,
      w: BOUNDS.width - halfW - SNAP_INSET,
      h: BOUNDS.height - halfH - SNAP_INSET,
    });
  });

  it("respects custom band sizes", () => {
    expect(detectSnapZone({ x: 60, y: 400 }, BOUNDS, { edgeBand: 80 })?.kind).toBe("left");
    expect(detectSnapZone({ x: 60, y: 400 }, BOUNDS, { edgeBand: 30 })?.kind).toBeUndefined();
  });

  it("snap geometry covers the full canvas (modulo insets)", () => {
    const r = detectSnapZone({ x: 500, y: 1 }, BOUNDS);
    if (!r) throw new Error("expected snap");
    expect(r.geometry.x + r.geometry.w).toBe(BOUNDS.width - SNAP_INSET);
    expect(r.geometry.y + r.geometry.h).toBe(BOUNDS.height - SNAP_INSET);
  });
});

describe("detectSnapZone — gap zones", () => {
  it("vertical gap between two stacked windows: pointer in gap → 'gap'", () => {
    // Window A on top half, Window B on bottom — leaving a 100px gap at y=300..400.
    const a: OtherWindow = { x: 100, y: 100, w: 800, h: 200 };
    const b: OtherWindow = { x: 100, y: 400, w: 800, h: 300 };
    const r = detectSnapZone({ x: 500, y: 350 }, BOUNDS, { otherWindows: [a, b] });
    expect(r?.kind).toBe("gap");
    // Geometry should fill the gap (with inset)
    if (!r) throw new Error("expected snap");
    expect(r.geometry.y).toBeGreaterThanOrEqual(300);
    expect(r.geometry.y + r.geometry.h).toBeLessThanOrEqual(400);
  });

  it("horizontal gap between two side-by-side windows: pointer in gap → 'gap'", () => {
    const a: OtherWindow = { x: 100, y: 200, w: 200, h: 400 };
    const b: OtherWindow = { x: 400, y: 200, w: 300, h: 400 };
    const r = detectSnapZone({ x: 350, y: 400 }, BOUNDS, { otherWindows: [a, b] });
    expect(r?.kind).toBe("gap");
    if (!r) throw new Error("expected snap");
    expect(r.geometry.x).toBeGreaterThanOrEqual(300);
    expect(r.geometry.x + r.geometry.w).toBeLessThanOrEqual(400);
  });

  it("non-overlapping pair (no shared axis) produces no gap", () => {
    // A is top-left, B is bottom-right — no clean horizontal or vertical gap.
    const a: OtherWindow = { x: 0, y: 0, w: 200, h: 200 };
    const b: OtherWindow = { x: 600, y: 500, w: 200, h: 200 };
    const r = detectSnapZone({ x: 400, y: 350 }, BOUNDS, { otherWindows: [a, b] });
    expect(r).toBeNull();
  });

  it("trivial gaps (< MIN_GAP) produce no zone", () => {
    // 20px-tall vertical gap — too small to fit a window.
    const a: OtherWindow = { x: 100, y: 100, w: 800, h: 200 };
    const b: OtherWindow = { x: 100, y: 320, w: 800, h: 300 };
    const r = detectSnapZone({ x: 500, y: 310 }, BOUNDS, { otherWindows: [a, b] });
    expect(r).toBeNull();
  });
});

describe("detectSnapZone — split zones", () => {
  // Window centered, far from the canvas edges so we don't trip the edge family.
  const win: OtherWindow = { x: 200, y: 200, w: 600, h: 400 };

  it("right third × middle third → split-r (right half of window)", () => {
    const r = detectSnapZone({ x: 700, y: 400 }, BOUNDS, { otherWindows: [win] });
    expect(r?.kind).toBe("split-r");
    // Right half starts at win.x + halfW (300)
    expect(r?.geometry.x).toBeGreaterThanOrEqual(win.x + win.w / 2 - 1);
  });

  it("top-left third × top third → split-tl (top-left quarter of window)", () => {
    const r = detectSnapZone({ x: 250, y: 250 }, BOUNDS, { otherWindows: [win] });
    expect(r?.kind).toBe("split-tl");
  });

  it("top-right third × top third → split-tr", () => {
    const r = detectSnapZone({ x: 750, y: 250 }, BOUNDS, { otherWindows: [win] });
    expect(r?.kind).toBe("split-tr");
  });

  it("bottom-left third × bottom third → split-bl", () => {
    const r = detectSnapZone({ x: 250, y: 550 }, BOUNDS, { otherWindows: [win] });
    expect(r?.kind).toBe("split-bl");
  });

  it("dead centre of a window → no zone", () => {
    const r = detectSnapZone({ x: 500, y: 400 }, BOUNDS, { otherWindows: [win] });
    expect(r).toBeNull();
  });

  it("pointer outside any window and outside edge bands → no zone", () => {
    // Pointer at (200, 200) — well clear of canvas edges (32 px band) and
    // outside the lone window at (500, 500). Nothing should match.
    const r = detectSnapZone({ x: 200, y: 200 }, BOUNDS, {
      otherWindows: [{ x: 500, y: 500, w: 100, h: 100 }],
    });
    expect(r).toBeNull();
  });
});

describe("detectSnapZone — priority ordering", () => {
  it("canvas-edge wins over split when pointer is in the edge band AND inside a window", () => {
    // Window covers the entire left-edge band — pointer at (10, 400) is in
    // both the canvas-left band AND inside the window. Edge family wins.
    const win: OtherWindow = { x: 0, y: 100, w: 400, h: 600 };
    const r = detectSnapZone({ x: 10, y: 400 }, BOUNDS, { otherWindows: [win] });
    expect(r?.kind).toBe("left");
  });

  it("gap wins over split when both could match (pointer in a gap that's also inside a third window's bounds)", () => {
    // Two stacked windows leaving a vertical gap at y=300..400.
    const a: OtherWindow = { x: 100, y: 100, w: 800, h: 200 };
    const b: OtherWindow = { x: 100, y: 400, w: 800, h: 300 };
    // A third window happens to cover the same area (e.g. an overlapping
    // floating window) — shouldn't matter, gap detection runs over the
    // same `others` list and finds the (a,b) gap first.
    const c: OtherWindow = { x: 400, y: 250, w: 200, h: 200 };
    const r = detectSnapZone({ x: 500, y: 350 }, BOUNDS, { otherWindows: [a, b, c] });
    expect(r?.kind).toBe("gap");
  });

  it("split fires when the pointer is fully inside a window with no canvas-edge or gap match", () => {
    const win: OtherWindow = { x: 300, y: 300, w: 400, h: 300 };
    const r = detectSnapZone({ x: 350, y: 400 }, BOUNDS, { otherWindows: [win] });
    expect(r?.kind).toBe("split-l");
  });
});
