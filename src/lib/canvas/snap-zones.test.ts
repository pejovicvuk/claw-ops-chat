import { describe, expect, it } from "vitest";
import {
  CORNER_BAND,
  EDGE_BAND,
  POINTER_TOLERANCE,
  RESIZE_SNAP_TOLERANCE,
  SNAP_INSET,
  detectDragRectSnap,
  applyLineDelta,
  detectResizeSnap,
  detectSnapZone,
  findResizeGroup,
  largestFreeRectInZone,
  lineShift,
  type CanvasBounds,
  type OtherWindow,
  type ResizeRect,
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

describe("CORNER_BAND — wider corner acquisition zone", () => {
  it("CORNER_BAND is larger than EDGE_BAND", () => {
    expect(CORNER_BAND).toBeGreaterThan(EDGE_BAND);
  });

  it("pointer just outside EDGE_BAND on both axes still triggers a corner", () => {
    // (EDGE_BAND+1, EDGE_BAND+1) is past the edge band but inside the
    // corner band — pre-fix this would fall through, post-fix it fires tl.
    const r = detectSnapZone({ x: EDGE_BAND + 1, y: EDGE_BAND + 1 }, BOUNDS);
    expect(r?.kind).toBe("tl");
  });

  it("bottom-right corner fires when pointer is inside CORNER_BAND but past EDGE_BAND", () => {
    const r = detectSnapZone(
      { x: BOUNDS.width - EDGE_BAND - 1, y: BOUNDS.height - EDGE_BAND - 1 },
      BOUNDS,
    );
    expect(r?.kind).toBe("br");
  });

  it("just outside the corner band on both axes → falls back (null when no edge match either)", () => {
    const r = detectSnapZone({ x: CORNER_BAND + 1, y: CORNER_BAND + 1 }, BOUNDS);
    expect(r).toBeNull();
  });
});

describe("detectResizeSnap — fit-to-available", () => {
  // Window starts as a small rect somewhere on the canvas; the resize
  // edge is the one being dragged. Slack is "how far the edge can travel
  // before hitting a limit"; snap fires when slack ≤ RESIZE_SNAP_TOLERANCE.
  const rect: ResizeRect = { x: 200, y: 200, w: 400, h: 300 };

  it("E edge with no obstacles, edge near canvas right → fills to canvas.right", () => {
    // Move rect close to the right wall: x + w is at width - 10.
    const moved: ResizeRect = { x: BOUNDS.width - 410, y: 200, w: 400, h: 300 };
    const r = detectResizeSnap(moved, "e", BOUNDS, []);
    expect(r?.kind).toBe("right");
    if (!r) throw new Error("expected snap");
    expect(r.geometry.x + r.geometry.w).toBe(BOUNDS.width - SNAP_INSET);
    // Top / bottom anchored.
    expect(r.geometry.y).toBe(moved.y + SNAP_INSET);
    expect(r.geometry.h).toBe(moved.h - 2 * SNAP_INSET);
  });

  it("E edge with one obstacle to the right → fills to that obstacle's left", () => {
    const moved: ResizeRect = { x: 100, y: 200, w: 400, h: 300 };
    const obstacle: ResizeRect = { x: 520, y: 100, w: 200, h: 600 };
    const r = detectResizeSnap(moved, "e", BOUNDS, [obstacle]);
    expect(r?.kind).toBe("right");
    if (!r) throw new Error("expected snap");
    expect(r.geometry.x + r.geometry.w).toBe(obstacle.x - SNAP_INSET);
  });

  it("E edge already at canvas edge (no slack) → null", () => {
    const flush: ResizeRect = { x: 200, y: 200, w: BOUNDS.width - 200, h: 300 };
    const r = detectResizeSnap(flush, "e", BOUNDS, []);
    expect(r).toBeNull();
  });

  it("E edge with slack greater than tolerance → null", () => {
    // 200 + 400 = 600; canvas right at 1000; slack 400 >> tolerance.
    const r = detectResizeSnap(rect, "e", BOUNDS, []);
    expect(r).toBeNull();
  });

  it("SE corner with empty space, both edges within tolerance → fills both axes", () => {
    const moved: ResizeRect = {
      x: 100,
      y: 100,
      w: BOUNDS.width - 100 - 10,
      h: BOUNDS.height - 100 - 10,
    };
    const r = detectResizeSnap(moved, "se", BOUNDS, []);
    expect(r?.kind).toBe("br");
    if (!r) throw new Error("expected snap");
    expect(r.geometry.x + r.geometry.w).toBe(BOUNDS.width - SNAP_INSET);
    expect(r.geometry.y + r.geometry.h).toBe(BOUNDS.height - SNAP_INSET);
  });

  it("SE corner with an obstacle on the right → fills to obstacle on x, canvas on y", () => {
    const moved: ResizeRect = {
      x: 100,
      y: 100,
      w: 400,
      h: BOUNDS.height - 100 - 10,
    };
    // Obstacle at right covers full height so it's a valid x-limit, but
    // its y range would also overlap the moved rect's bottom — stay clear
    // of the bottom-limit path with a row above the moved rect.
    const obstacle: ResizeRect = { x: 520, y: 0, w: 200, h: BOUNDS.height };
    const r = detectResizeSnap(moved, "se", BOUNDS, [obstacle]);
    expect(r?.kind).toBe("br");
    if (!r) throw new Error("expected snap");
    expect(r.geometry.x + r.geometry.w).toBe(obstacle.x - SNAP_INSET);
    expect(r.geometry.y + r.geometry.h).toBe(BOUNDS.height - SNAP_INSET);
  });

  it("SE corner already at canvas corner → null", () => {
    const flush: ResizeRect = {
      x: 200,
      y: 200,
      w: BOUNDS.width - 200,
      h: BOUNDS.height - 200,
    };
    const r = detectResizeSnap(flush, "se", BOUNDS, []);
    expect(r).toBeNull();
  });

  it("W edge near left limit fills to 0 with right edge anchored", () => {
    const moved: ResizeRect = { x: 10, y: 200, w: 400, h: 300 };
    const r = detectResizeSnap(moved, "w", BOUNDS, []);
    expect(r?.kind).toBe("left");
    if (!r) throw new Error("expected snap");
    expect(r.geometry.x).toBe(SNAP_INSET);
    // Right edge anchored: x + w == moved.x + moved.w
    expect(r.geometry.x + r.geometry.w).toBe(moved.x + moved.w - SNAP_INSET);
  });

  it("S edge near canvas bottom fills to canvas height", () => {
    const moved: ResizeRect = {
      x: 200,
      y: 200,
      w: 400,
      h: BOUNDS.height - 200 - 10,
    };
    const r = detectResizeSnap(moved, "s", BOUNDS, []);
    expect(r?.kind).toBe("bottom");
    if (!r) throw new Error("expected snap");
    expect(r.geometry.y + r.geometry.h).toBe(BOUNDS.height - SNAP_INSET);
  });

  it("tolerance override controls the firing threshold", () => {
    const moved: ResizeRect = { x: 100, y: 200, w: 400, h: 300 };
    // slack = 500. With default tolerance 32 → null.
    expect(detectResizeSnap(moved, "e", BOUNDS, [])).toBeNull();
    // With tolerance 600 → fires.
    const r = detectResizeSnap(moved, "e", BOUNDS, [], { tolerance: 600 });
    expect(r?.kind).toBe("right");
  });

  it("RESIZE_SNAP_TOLERANCE is exported and positive", () => {
    expect(RESIZE_SNAP_TOLERANCE).toBeGreaterThan(0);
  });
});

describe("findResizeGroup — chained N-window detection", () => {
  const a: ResizeRect = { x: 100, y: 100, w: 400, h: 300 };

  it("returns [] when there are no other windows", () => {
    expect(findResizeGroup(a, "e", [])).toEqual([]);
  });

  it("finds a single anti-mover (PR #107 case — opposite edge on the line)", () => {
    // b's W is on a's right edge; active drags E so b is anti.
    const b: ResizeRect = { x: 500, y: 150, w: 300, h: 200 };
    const group = findResizeGroup(a, "e", [{ id: "b", rect: b }]);
    expect(group).toEqual([{ id: "b", start: b, role: "anti" }]);
  });

  it("finds two co-movers (chained: A top-left + B bottom-left + C right)", () => {
    // Active is C (right window, full height). Drag W edge.
    // A and B are both on the left, both with E edges on C's left line.
    // Both are "co" (same edge as ... wait, active is W; A/B have E on the line).
    // active edge = "w", member edge on line = E → role = anti.
    // Let me reconfigure: active is one of the LEFT stack windows dragging E.
    // Then the OTHER left window also has E on the same line (co), and the
    // right window has W on the line (anti). So group = [otherLeft co, right anti].
    const aLeft: ResizeRect = { x: 100, y: 100, w: 400, h: 150 }; // top-left
    const bLeft: ResizeRect = { x: 100, y: 250, w: 400, h: 150 }; // bottom-left
    const cRight: ResizeRect = { x: 500, y: 100, w: 300, h: 300 }; // tall right
    // User drags aLeft's E edge (active = aLeft).
    const group = findResizeGroup(aLeft, "e", [
      { id: "b", rect: bLeft },
      { id: "c", rect: cRight },
    ]);
    expect(group).toHaveLength(2);
    expect(group.find((m) => m.id === "b")).toEqual({ id: "b", start: bLeft, role: "co" });
    expect(group.find((m) => m.id === "c")).toEqual({ id: "c", start: cRight, role: "anti" });
  });

  it("returns [] when the candidate does not perpendicular-overlap", () => {
    const b: ResizeRect = { x: 500, y: 500, w: 300, h: 200 }; // y-range [500..700], a is [100..400]
    expect(findResizeGroup(a, "e", [{ id: "b", rect: b }])).toEqual([]);
  });

  it("returns [] when the candidate is too far from the line", () => {
    const b: ResizeRect = { x: 600, y: 150, w: 300, h: 200 };
    expect(findResizeGroup(a, "e", [{ id: "b", rect: b }])).toEqual([]);
  });

  it("returns [] for corner edges (group resize is edge-only)", () => {
    const b: ResizeRect = { x: 500, y: 100, w: 300, h: 300 };
    expect(findResizeGroup(a, "ne", [{ id: "b", rect: b }])).toEqual([]);
    expect(findResizeGroup(a, "se", [{ id: "b", rect: b }])).toEqual([]);
  });

  it("respects the tolerance for borders 'almost touching'", () => {
    const b: ResizeRect = { x: 503, y: 150, w: 300, h: 200 };
    const inTol = findResizeGroup(a, "e", [{ id: "b", rect: b }], 4);
    expect(inTol).toEqual([{ id: "b", start: b, role: "anti" }]);
    const outOfTol = findResizeGroup(a, "e", [{ id: "b", rect: b }], 2);
    expect(outOfTol).toEqual([]);
  });

  it("horizontal chain: active S edge with one co-mover and one anti-mover", () => {
    // Active is top-left (full width left), shared horizontal line at y=400.
    // Top-right also ends at y=400 (co). Bottom-right starts at y=400 (anti).
    const active: ResizeRect = { x: 0, y: 100, w: 400, h: 300 };
    const tr: ResizeRect = { x: 400, y: 100, w: 400, h: 300 };
    const br: ResizeRect = { x: 400, y: 400, w: 400, h: 300 };
    const group = findResizeGroup(active, "s", [
      { id: "tr", rect: tr },
      { id: "br", rect: br },
    ]);
    expect(group).toHaveLength(2);
    expect(group.find((m) => m.id === "tr")?.role).toBe("co");
    expect(group.find((m) => m.id === "br")?.role).toBe("anti");
  });
});

describe("lineShift", () => {
  const start: ResizeRect = { x: 100, y: 200, w: 400, h: 300 };

  it("returns 0 when geometry is unchanged", () => {
    expect(lineShift(start, start, "e")).toBe(0);
  });

  it("returns delta_x for E edge", () => {
    const moved = { ...start, w: 450 };
    expect(lineShift(moved, start, "e")).toBe(50);
  });

  it("returns delta_x for W edge", () => {
    const moved = { ...start, x: 80, w: 420 };
    expect(lineShift(moved, start, "w")).toBe(-20);
  });

  it("returns delta_y for S edge", () => {
    const moved = { ...start, h: 350 };
    expect(lineShift(moved, start, "s")).toBe(50);
  });

  it("returns delta_y for N edge", () => {
    const moved = { ...start, y: 180, h: 320 };
    expect(lineShift(moved, start, "n")).toBe(-20);
  });

  it("returns 0 for corner edges (out of scope)", () => {
    const moved = { ...start, w: 450, h: 350 };
    expect(lineShift(moved, start, "se")).toBe(0);
  });
});

describe("applyLineDelta — geometry math for each role × edge", () => {
  const start: ResizeRect = { x: 200, y: 100, w: 300, h: 200 };

  it("E + co (other E on line) → grows w by delta", () => {
    const r = applyLineDelta(start, "co", "e", 50);
    expect(r).toEqual({ x: 200, y: 100, w: 350, h: 200 });
  });

  it("E + anti (W on line) → shifts x and shrinks w by delta", () => {
    const r = applyLineDelta(start, "anti", "e", 50);
    expect(r).toEqual({ x: 250, y: 100, w: 250, h: 200 });
  });

  it("W + co (other W on line) → shifts x and shrinks w by delta", () => {
    const r = applyLineDelta(start, "co", "w", 30);
    expect(r).toEqual({ x: 230, y: 100, w: 270, h: 200 });
  });

  it("W + anti (E on line) → grows w by delta", () => {
    const r = applyLineDelta(start, "anti", "w", -40);
    expect(r).toEqual({ x: 200, y: 100, w: 260, h: 200 });
  });

  it("S + co → grows h", () => {
    const r = applyLineDelta(start, "co", "s", 40);
    expect(r).toEqual({ x: 200, y: 100, w: 300, h: 240 });
  });

  it("S + anti → shifts y and shrinks h", () => {
    const r = applyLineDelta(start, "anti", "s", 40);
    expect(r).toEqual({ x: 200, y: 140, w: 300, h: 160 });
  });

  it("N + co → shifts y and shrinks h", () => {
    const r = applyLineDelta(start, "co", "n", 20);
    expect(r).toEqual({ x: 200, y: 120, w: 300, h: 180 });
  });

  it("N + anti → grows h", () => {
    const r = applyLineDelta(start, "anti", "n", -25);
    expect(r).toEqual({ x: 200, y: 100, w: 300, h: 175 });
  });

  it("delta of 0 returns identical geometry for any edge/role", () => {
    expect(applyLineDelta(start, "co", "e", 0)).toEqual(start);
    expect(applyLineDelta(start, "anti", "n", 0)).toEqual(start);
  });
});

describe("detectDragRectSnap — rect-based canvas-edge family", () => {
  // A small window we'll move around to hit each zone. Default position
  // is centred so it shouldn't trigger anything.
  const w = 400;
  const h = 300;
  const centred = {
    x: Math.floor((BOUNDS.width - w) / 2),
    y: Math.floor((BOUNDS.height - h) / 2),
    w,
    h,
  };

  it("centred window → null", () => {
    expect(detectDragRectSnap(centred, BOUNDS)).toBeNull();
  });

  it("window's left edge near 0 → 'left'", () => {
    const r = detectDragRectSnap({ ...centred, x: 5 }, BOUNDS);
    expect(r?.kind).toBe("left");
  });

  it("window's right edge near canvas width → 'right'", () => {
    const r = detectDragRectSnap({ ...centred, x: BOUNDS.width - w - 5 }, BOUNDS);
    expect(r?.kind).toBe("right");
  });

  it("window's top edge near 0 → 'top'", () => {
    const r = detectDragRectSnap({ ...centred, y: 5 }, BOUNDS);
    expect(r?.kind).toBe("top");
  });

  it("window's bottom edge near canvas height → 'bottom'", () => {
    const r = detectDragRectSnap({ ...centred, y: BOUNDS.height - h - 5 }, BOUNDS);
    expect(r?.kind).toBe("bottom");
  });

  it("window's TL corner near canvas TL → 'tl' (and pointer is irrelevant)", () => {
    const r = detectDragRectSnap({ x: 5, y: 5, w, h }, BOUNDS);
    expect(r?.kind).toBe("tl");
  });

  it("window's BR corner near canvas BR → 'br' (the case that was broken)", () => {
    const r = detectDragRectSnap(
      { x: BOUNDS.width - w - 5, y: BOUNDS.height - h - 5, w, h },
      BOUNDS,
    );
    expect(r?.kind).toBe("br");
  });

  it("window's TR corner near canvas TR → 'tr'", () => {
    const r = detectDragRectSnap({ x: BOUNDS.width - w - 5, y: 5, w, h }, BOUNDS);
    expect(r?.kind).toBe("tr");
  });

  it("window's BL corner near canvas BL → 'bl'", () => {
    const r = detectDragRectSnap({ x: 5, y: BOUNDS.height - h - 5, w, h }, BOUNDS);
    expect(r?.kind).toBe("bl");
  });

  it("corner band wins over edge band when both axes are inside the wider band", () => {
    // Pull the window so its top-left corner is past EDGE_BAND on both
    // axes but inside CORNER_BAND. This is the same regression the corner
    // band test covers for the pointer detector — confirm the rect path
    // honours it too.
    const r = detectDragRectSnap({ x: EDGE_BAND + 1, y: EDGE_BAND + 1, w, h }, BOUNDS);
    expect(r?.kind).toBe("tl");
  });

  it("just outside the corner band on both axes (and edge band) → null", () => {
    const r = detectDragRectSnap({ x: CORNER_BAND + 1, y: CORNER_BAND + 1, w, h }, BOUNDS);
    expect(r).toBeNull();
  });

  it("obstacle in the matched zone → adaptive geometry shrinks", () => {
    // Window's left edge is near canvas left → 'left' fires. With a
    // blocker covering the top of the left half, the snap geometry
    // should sit below the blocker.
    const blocker: OtherWindow = { x: 0, y: 0, w: 500, h: 300 };
    const r = detectDragRectSnap({ ...centred, x: 5 }, BOUNDS, {
      otherWindows: [blocker],
    });
    expect(r?.kind).toBe("left");
    if (!r) throw new Error("expected snap");
    expect(r.geometry.y).toBeGreaterThanOrEqual(300);
  });

  it("zero bounds → null", () => {
    expect(detectDragRectSnap({ x: 0, y: 0, w: 0, h: 0 }, { width: 0, height: 0 })).toBeNull();
  });
});
