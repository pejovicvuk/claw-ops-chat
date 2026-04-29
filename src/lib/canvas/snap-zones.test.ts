import { describe, expect, it } from "vitest";
import { EDGE_BAND, SNAP_INSET, TOP_BAND, detectSnapZone, type CanvasBounds } from "./snap-zones";

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
