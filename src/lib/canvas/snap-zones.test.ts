import { describe, expect, it } from "vitest";
import {
  EDGE_BAND,
  POINTER_TOLERANCE,
  SNAP_INSET,
  detectSnapZone,
  largestFreeRectInZone,
  type CanvasBounds,
  type OtherWindow,
} from "./snap-zones";

const BOUNDS: CanvasBounds = { width: 1000, height: 800 };

describe("detectSnapZone — adaptive canvas-edge zones (empty canvas)", () => {
  it("returns null in the dead centre", () => {
    expect(detectSnapZone({ x: 500, y: 400 }, BOUNDS)).toBeNull();
  });

  it("returns null when bounds are zero", () => {
    expect(detectSnapZone({ x: 0, y: 0 }, { width: 0, height: 0 })).toBeNull();
  });

  it("left edge → full left half", () => {
    const r = detectSnapZone({ x: 5, y: 400 }, BOUNDS);
    expect(r?.kind).toBe("left");
    if (!r) throw new Error("expected snap");
    // Left half (with inset)
    expect(r.geometry.x).toBe(SNAP_INSET);
    expect(r.geometry.w).toBe(Math.floor(BOUNDS.width / 2) - 2 * SNAP_INSET);
    expect(r.geometry.h).toBe(BOUNDS.height - 2 * SNAP_INSET);
  });

  it("right edge → full right half", () => {
    const r = detectSnapZone({ x: BOUNDS.width - 5, y: 400 }, BOUNDS);
    expect(r?.kind).toBe("right");
    if (!r) throw new Error("expected snap");
    const halfW = Math.floor(BOUNDS.width / 2);
    expect(r.geometry.x).toBe(halfW + SNAP_INSET);
    expect(r.geometry.w).toBe(BOUNDS.width - halfW - 2 * SNAP_INSET);
  });

  it("top edge → full top half (no max — drag never produces fullscreen)", () => {
    const r = detectSnapZone({ x: 500, y: 1 }, BOUNDS);
    expect(r?.kind).toBe("top");
    if (!r) throw new Error("expected snap");
    const halfH = Math.floor(BOUNDS.height / 2);
    expect(r.geometry.h).toBe(halfH - 2 * SNAP_INSET);
    // Critically: the geometry covers AT MOST half the height.
    expect(r.geometry.y + r.geometry.h).toBeLessThanOrEqual(halfH);
  });

  it("bottom edge → full bottom half", () => {
    const r = detectSnapZone({ x: 500, y: BOUNDS.height - 5 }, BOUNDS);
    expect(r?.kind).toBe("bottom");
    if (!r) throw new Error("expected snap");
    const halfH = Math.floor(BOUNDS.height / 2);
    expect(r.geometry.y).toBe(halfH + SNAP_INSET);
    expect(r.geometry.h).toBe(BOUNDS.height - halfH - 2 * SNAP_INSET);
  });

  it("top-left corner → top-left quarter", () => {
    const r = detectSnapZone({ x: 5, y: 5 }, BOUNDS);
    expect(r?.kind).toBe("tl");
    if (!r) throw new Error("expected snap");
    const halfW = Math.floor(BOUNDS.width / 2);
    const halfH = Math.floor(BOUNDS.height / 2);
    expect(r.geometry.x + r.geometry.w).toBeLessThanOrEqual(halfW);
    expect(r.geometry.y + r.geometry.h).toBeLessThanOrEqual(halfH);
  });

  it("top-right corner → top-right quarter", () => {
    const r = detectSnapZone({ x: BOUNDS.width - 5, y: 5 }, BOUNDS);
    expect(r?.kind).toBe("tr");
  });

  it("bottom-right corner → bottom-right quarter", () => {
    const r = detectSnapZone({ x: BOUNDS.width - 5, y: BOUNDS.height - 5 }, BOUNDS);
    expect(r?.kind).toBe("br");
  });

  it("bottom-left corner → bottom-left quarter", () => {
    const r = detectSnapZone({ x: 5, y: BOUNDS.height - 5 }, BOUNDS);
    expect(r?.kind).toBe("bl");
  });
});

describe("detectSnapZone — out-of-bounds tolerance", () => {
  it("pointer past the right edge (within tolerance) still triggers right snap", () => {
    const r = detectSnapZone({ x: BOUNDS.width + 10, y: 400 }, BOUNDS);
    expect(r?.kind).toBe("right");
  });

  it("pointer past the bottom edge (within tolerance) still triggers bottom snap", () => {
    const r = detectSnapZone({ x: 500, y: BOUNDS.height + 10 }, BOUNDS);
    expect(r?.kind).toBe("bottom");
  });

  it("pointer past the left edge still triggers left snap", () => {
    const r = detectSnapZone({ x: -10, y: 400 }, BOUNDS);
    expect(r?.kind).toBe("left");
  });

  it("pointer well outside tolerance returns null", () => {
    expect(detectSnapZone({ x: BOUNDS.width + POINTER_TOLERANCE + 1, y: 400 }, BOUNDS)).toBeNull();
    expect(detectSnapZone({ x: 500, y: BOUNDS.height + POINTER_TOLERANCE + 1 }, BOUNDS)).toBeNull();
  });
});

describe("detectSnapZone — adaptive shrinking around obstacles", () => {
  it("left half occupied at top → left snap shrinks to bottom of the left half", () => {
    // Window covers the top-left corner
    const blocker: OtherWindow = { x: 0, y: 0, w: 500, h: 300 };
    const r = detectSnapZone({ x: 5, y: 600 }, BOUNDS, { otherWindows: [blocker] });
    expect(r?.kind).toBe("left");
    if (!r) throw new Error("expected snap");
    // The free rect should start AT or below the blocker's bottom (300).
    expect(r.geometry.y).toBeGreaterThanOrEqual(300);
    expect(r.geometry.y + r.geometry.h).toBeLessThanOrEqual(BOUNDS.height);
  });

  it("entire left half blocked → falls through (split-l fires because pointer is inside the blocker)", () => {
    const blocker: OtherWindow = { x: 0, y: 0, w: 500, h: BOUNDS.height };
    const r = detectSnapZone({ x: 5, y: 400 }, BOUNDS, { otherWindows: [blocker] });
    // Edge zone returns null (no free space). Pointer is inside the
    // blocker so the split family fires. Result: split-l (left third
    // of the blocker).
    expect(r?.kind).toBe("split-l");
  });

  it("top half partially covered by a centred window → top snap finds the largest free region", () => {
    const blocker: OtherWindow = { x: 200, y: 50, w: 600, h: 250 };
    const r = detectSnapZone({ x: 500, y: 5 }, BOUNDS, { otherWindows: [blocker] });
    expect(r?.kind).toBe("top");
    if (!r) throw new Error("expected snap");
    // Some part of the top half must be free; the result fits entirely
    // inside the top-half sector.
    expect(r.geometry.y).toBeGreaterThanOrEqual(0);
    expect(r.geometry.y + r.geometry.h).toBeLessThanOrEqual(Math.floor(BOUNDS.height / 2));
  });

  it("corner zones cap at quarter even on an empty canvas", () => {
    const r = detectSnapZone({ x: 5, y: 5 }, BOUNDS);
    if (!r || r.kind !== "tl") throw new Error("expected tl");
    const halfW = Math.floor(BOUNDS.width / 2);
    const halfH = Math.floor(BOUNDS.height / 2);
    expect(r.geometry.w).toBeLessThanOrEqual(halfW);
    expect(r.geometry.h).toBeLessThanOrEqual(halfH);
  });

  it("edge zones cap at half even on an empty canvas", () => {
    const r = detectSnapZone({ x: 5, y: 400 }, BOUNDS);
    if (!r || r.kind !== "left") throw new Error("expected left");
    const halfW = Math.floor(BOUNDS.width / 2);
    expect(r.geometry.w).toBeLessThanOrEqual(halfW);
  });
});

describe("largestFreeRectInZone (pure helper)", () => {
  it("returns the whole zone when no obstacles intersect", () => {
    const r = largestFreeRectInZone({ x: 0, y: 0, w: 100, h: 100 }, []);
    expect(r).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it("ignores obstacles that don't intersect the zone", () => {
    const r = largestFreeRectInZone({ x: 0, y: 0, w: 100, h: 100 }, [
      { x: 200, y: 200, w: 50, h: 50 },
    ]);
    expect(r).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it("with one obstacle in the middle, picks the larger of the four free strips", () => {
    // Zone 100x100, obstacle 40x40 in middle from (30,30). Free strips:
    //   top: 100x30, bottom: 100x30, left: 30x100, right: 30x100. All same area.
    // Output area should be 3000.
    const r = largestFreeRectInZone({ x: 0, y: 0, w: 100, h: 100 }, [
      { x: 30, y: 30, w: 40, h: 40 },
    ]);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.w * r.h).toBe(3000);
  });

  it("returns null when the zone is fully obstructed", () => {
    const r = largestFreeRectInZone({ x: 0, y: 0, w: 100, h: 100 }, [
      { x: 0, y: 0, w: 100, h: 100 },
    ]);
    expect(r).toBeNull();
  });

  it("returns null for zero / negative zone size", () => {
    expect(largestFreeRectInZone({ x: 0, y: 0, w: 0, h: 100 }, [])).toBeNull();
    expect(largestFreeRectInZone({ x: 0, y: 0, w: 100, h: -10 }, [])).toBeNull();
  });
});

describe("detectSnapZone — gap zones (regression)", () => {
  it("vertical gap between two stacked windows → 'gap'", () => {
    const a: OtherWindow = { x: 100, y: 100, w: 800, h: 200 };
    const b: OtherWindow = { x: 100, y: 400, w: 800, h: 300 };
    const r = detectSnapZone({ x: 500, y: 350 }, BOUNDS, { otherWindows: [a, b] });
    expect(r?.kind).toBe("gap");
  });

  it("horizontal gap between two side-by-side windows → 'gap'", () => {
    const a: OtherWindow = { x: 100, y: 200, w: 200, h: 400 };
    const b: OtherWindow = { x: 400, y: 200, w: 300, h: 400 };
    const r = detectSnapZone({ x: 350, y: 400 }, BOUNDS, { otherWindows: [a, b] });
    expect(r?.kind).toBe("gap");
  });

  it("trivial gap (< MIN_GAP) doesn't fire", () => {
    const a: OtherWindow = { x: 100, y: 100, w: 800, h: 200 };
    const b: OtherWindow = { x: 100, y: 320, w: 800, h: 300 };
    const r = detectSnapZone({ x: 500, y: 310 }, BOUNDS, { otherWindows: [a, b] });
    expect(r).toBeNull();
  });
});

describe("detectSnapZone — split zones (regression)", () => {
  const win: OtherWindow = { x: 200, y: 200, w: 600, h: 400 };

  it("right third × middle third → split-r", () => {
    const r = detectSnapZone({ x: 700, y: 400 }, BOUNDS, { otherWindows: [win] });
    expect(r?.kind).toBe("split-r");
  });

  it("dead centre → no zone", () => {
    const r = detectSnapZone({ x: 500, y: 400 }, BOUNDS, { otherWindows: [win] });
    expect(r).toBeNull();
  });
});

describe("detectSnapZone — priority ordering", () => {
  it("canvas-edge wins over split when pointer is near the edge AND there's free space in the sector", () => {
    // Blocker doesn't fully cover the left sector — there's a free
    // strip the algorithm finds, so left-edge snap takes priority
    // over the split that would otherwise fire if pointer were inside.
    const win: OtherWindow = { x: 100, y: 100, w: 200, h: 600 };
    const r = detectSnapZone({ x: 10, y: 400 }, BOUNDS, { otherWindows: [win] });
    expect(r?.kind).toBe("left");
  });

  it("gap wins over split when both could match", () => {
    const a: OtherWindow = { x: 100, y: 100, w: 800, h: 200 };
    const b: OtherWindow = { x: 100, y: 400, w: 800, h: 300 };
    const c: OtherWindow = { x: 400, y: 250, w: 200, h: 200 };
    const r = detectSnapZone({ x: 500, y: 350 }, BOUNDS, { otherWindows: [a, b, c] });
    expect(r?.kind).toBe("gap");
  });

  it("near edge near a wide blocker uses the adaptive shrunk geometry", () => {
    // Blocker covers most of the left half top. Drag near left edge → snap
    // shrinks to the bottom strip of the left half.
    const blocker: OtherWindow = { x: 0, y: 0, w: 500, h: 600 };
    const r = detectSnapZone({ x: 5, y: 700 }, BOUNDS, { otherWindows: [blocker] });
    expect(r?.kind).toBe("left");
    if (!r) throw new Error("expected snap");
    expect(r.geometry.y).toBeGreaterThanOrEqual(600);
  });
});

describe("EDGE_BAND boundary", () => {
  it("just inside the band → snap fires", () => {
    const r = detectSnapZone({ x: EDGE_BAND - 1, y: 400 }, BOUNDS);
    expect(r?.kind).toBe("left");
  });

  it("just outside the band (and not near another edge) → null", () => {
    const r = detectSnapZone({ x: EDGE_BAND + 1, y: 400 }, BOUNDS);
    expect(r).toBeNull();
  });
});
