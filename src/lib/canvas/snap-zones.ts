import type { WindowGeometry } from "@/components/canvas/canvas-types";

/**
 * Smart snap-zone detection for the per-item canvas.
 *
 * Layers three increasingly specific zone families behind one entry point:
 *
 *   1. Adaptive canvas edges — the largest free rectangle within the
 *                              half (edge) or quarter (corner) sector
 *                              the pointer is closest to. Empty zones
 *                              are skipped. Capped at half-canvas-area
 *                              for edges and quarter for corners — drag
 *                              never produces a fullscreen snap.
 *   2. Inter-window gaps     — when the pointer is between two existing
 *                              windows along a shared axis, suggest
 *                              filling the gap rectangle.
 *   3. Window splits         — pointer hovering OVER an existing window
 *                              suggests a half/quarter of THAT window's
 *                              bounds.
 *
 * Pointer is clamped to canvas bounds with a 32 px tolerance so a drag
 * that drifts a pixel past the edge still registers — important for the
 * right edge that abuts the Files panel.
 *
 * All math is pure (no DOM, no React) so each family has its own table-
 * driven test cases.
 */

export const EDGE_BAND = 32;
/**
 * Wider trigger band reserved for the four canvas corners. Matching the
 * Windows 11 Snap behaviour: corners get a more forgiving acquisition area
 * than the edges so the user doesn't have to thread a 32 px diagonal needle.
 */
export const CORNER_BAND = 48;
export const SNAP_INSET = 2;
/** Pointer is allowed this many pixels outside canvas before we give up. */
export const POINTER_TOLERANCE = 32;
/** How close (px) a resize edge must be to its limit before resize-snap fires. */
export const RESIZE_SNAP_TOLERANCE = 32;

/** Tolerance (px) around an inter-window gap so the pointer doesn't have to be pixel-perfect. */
export const GAP_TOLERANCE = 16;
export const MIN_GAP_W = 80;
export const MIN_GAP_H = 80;

/**
 * Minimum width / height a free rect must have before we'll suggest
 * snapping into it. Set lower than `MIN_W` / `MIN_H` from `canvas-types`
 * because a tight snap is still useful to surface — the user can
 * resize after if they want more room.
 */
export const MIN_ZONE_W = 80;
export const MIN_ZONE_H = 80;

export type SnapKind =
  // Canvas-edge zones (now adaptive)
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "tl"
  | "tr"
  | "bl"
  | "br"
  // Inter-window gap
  | "gap"
  // Window splits (within an existing window's bounds)
  | "split-l"
  | "split-r"
  | "split-t"
  | "split-b"
  | "split-tl"
  | "split-tr"
  | "split-bl"
  | "split-br";

export interface CanvasBounds {
  width: number;
  height: number;
}

export interface PointerInCanvas {
  x: number;
  y: number;
}

export interface SnapResult {
  kind: SnapKind;
  geometry: WindowGeometry;
}

export interface OtherWindow {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DetectOptions {
  edgeBand?: number;
  cornerBand?: number;
  inset?: number;
  /** Other visible windows on the active page, EXCLUDING the dragged one. */
  otherWindows?: OtherWindow[];
}

interface InternalRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Returns the most specific snap suggestion for the pointer, or null.
 *
 * Priority order: adaptive canvas-edge → gap → split. Earlier families
 * short-circuit later ones. The pointer is clamped back into canvas
 * bounds with a 32 px tolerance so drags that graze the edge still
 * trigger their zone.
 */
export function detectSnapZone(
  pointer: PointerInCanvas,
  bounds: CanvasBounds,
  opts: DetectOptions = {},
): SnapResult | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  if (
    pointer.x < -POINTER_TOLERANCE ||
    pointer.y < -POINTER_TOLERANCE ||
    pointer.x > bounds.width + POINTER_TOLERANCE ||
    pointer.y > bounds.height + POINTER_TOLERANCE
  ) {
    return null;
  }
  // Clamp the pointer back into bounds — used only for zone calculation.
  // The "edge band" is naturally inclusive of the boundary now.
  const clamped: PointerInCanvas = {
    x: Math.min(Math.max(pointer.x, 0), bounds.width),
    y: Math.min(Math.max(pointer.y, 0), bounds.height),
  };

  const others = opts.otherWindows ?? [];

  const edge = detectAdaptiveEdgeZone(clamped, bounds, others, opts);
  if (edge) return edge;

  if (others.length > 0) {
    const gap = detectGapZone(clamped, others, opts);
    if (gap) return gap;

    const split = detectSplitZone(clamped, others, opts);
    if (split) return split;
  }

  return null;
}

/* ─────────────── adaptive canvas-edge family ─────────────── */

function detectAdaptiveEdgeZone(
  pointer: PointerInCanvas,
  bounds: CanvasBounds,
  obstacles: OtherWindow[],
  opts: DetectOptions,
): SnapResult | null {
  const edgeBand = opts.edgeBand ?? EDGE_BAND;
  const cornerBand = opts.cornerBand ?? CORNER_BAND;

  return resolveEdgeZone(
    {
      nearTop: pointer.y < edgeBand,
      nearBottom: pointer.y > bounds.height - edgeBand,
      nearLeft: pointer.x < edgeBand,
      nearRight: pointer.x > bounds.width - edgeBand,
      // Corner test uses a wider band so quarter-zone acquisition is
      // more forgiving — corners win whenever both axes fall inside it.
      nearCornerTop: pointer.y < cornerBand,
      nearCornerBottom: pointer.y > bounds.height - cornerBand,
      nearCornerLeft: pointer.x < cornerBand,
      nearCornerRight: pointer.x > bounds.width - cornerBand,
    },
    bounds,
    obstacles,
    opts.inset ?? SNAP_INSET,
  );
}

/**
 * Shared corner / edge zone resolver. Given pre-computed proximity
 * flags it emits the matching SnapResult or null. Both the pointer-
 * based detector (`detectAdaptiveEdgeZone`) and the rect-based
 * detector (`detectDragRectSnap`) call into this so the geometry +
 * priority logic lives in one place.
 */
interface ProximityFlags {
  nearTop: boolean;
  nearBottom: boolean;
  nearLeft: boolean;
  nearRight: boolean;
  nearCornerTop: boolean;
  nearCornerBottom: boolean;
  nearCornerLeft: boolean;
  nearCornerRight: boolean;
}

function resolveEdgeZone(
  near: ProximityFlags,
  bounds: CanvasBounds,
  obstacles: OtherWindow[],
  inset: number,
): SnapResult | null {
  const halfW = Math.floor(bounds.width / 2);
  const halfH = Math.floor(bounds.height / 2);

  // Corner zones first — quarter-sized sectors in the canvas.
  if (near.nearCornerTop && near.nearCornerLeft) {
    const rect = bestRectInZone({ x: 0, y: 0, w: halfW, h: halfH }, obstacles, inset);
    if (rect) return { kind: "tl", geometry: rect };
  }
  if (near.nearCornerTop && near.nearCornerRight) {
    const rect = bestRectInZone(
      { x: halfW, y: 0, w: bounds.width - halfW, h: halfH },
      obstacles,
      inset,
    );
    if (rect) return { kind: "tr", geometry: rect };
  }
  if (near.nearCornerBottom && near.nearCornerLeft) {
    const rect = bestRectInZone(
      { x: 0, y: halfH, w: halfW, h: bounds.height - halfH },
      obstacles,
      inset,
    );
    if (rect) return { kind: "bl", geometry: rect };
  }
  if (near.nearCornerBottom && near.nearCornerRight) {
    const rect = bestRectInZone(
      { x: halfW, y: halfH, w: bounds.width - halfW, h: bounds.height - halfH },
      obstacles,
      inset,
    );
    if (rect) return { kind: "br", geometry: rect };
  }

  // Edge zones — half-sized sectors covering one half of the canvas.
  if (near.nearLeft) {
    const rect = bestRectInZone({ x: 0, y: 0, w: halfW, h: bounds.height }, obstacles, inset);
    if (rect) return { kind: "left", geometry: rect };
  }
  if (near.nearRight) {
    const rect = bestRectInZone(
      { x: halfW, y: 0, w: bounds.width - halfW, h: bounds.height },
      obstacles,
      inset,
    );
    if (rect) return { kind: "right", geometry: rect };
  }
  if (near.nearTop) {
    const rect = bestRectInZone({ x: 0, y: 0, w: bounds.width, h: halfH }, obstacles, inset);
    if (rect) return { kind: "top", geometry: rect };
  }
  if (near.nearBottom) {
    const rect = bestRectInZone(
      { x: 0, y: halfH, w: bounds.width, h: bounds.height - halfH },
      obstacles,
      inset,
    );
    if (rect) return { kind: "bottom", geometry: rect };
  }

  return null;
}

/**
 * Rect-based drag-snap suggestion. Where `detectAdaptiveEdgeZone` reads
 * the *pointer* position to decide proximity to the canvas, this reads
 * the *window's geometry* — so any of the 4 window corners or 4 window
 * edges nearing the matching canvas edge fires a suggestion. This is
 * the right model for drag because the pointer is constrained to the
 * title bar, far from the bottom / right edges of the window. With this
 * helper, dragging a window so its BR corner is flush against the
 * canvas BR fires `br` even though the cursor is up at the header.
 *
 * Gap and split detection stay pointer-based — those depend on what
 * the user is hovering over.
 */
export function detectDragRectSnap(
  rect: { x: number; y: number; w: number; h: number },
  bounds: CanvasBounds,
  opts: DetectOptions = {},
): SnapResult | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const edgeBand = opts.edgeBand ?? EDGE_BAND;
  const cornerBand = opts.cornerBand ?? CORNER_BAND;
  const inset = opts.inset ?? SNAP_INSET;
  const obstacles = opts.otherWindows ?? [];

  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;

  return resolveEdgeZone(
    {
      nearLeft: rect.x < edgeBand,
      nearRight: bounds.width - right < edgeBand,
      nearTop: rect.y < edgeBand,
      nearBottom: bounds.height - bottom < edgeBand,
      nearCornerLeft: rect.x < cornerBand,
      nearCornerRight: bounds.width - right < cornerBand,
      nearCornerTop: rect.y < cornerBand,
      nearCornerBottom: bounds.height - bottom < cornerBand,
    },
    bounds,
    obstacles,
    inset,
  );
}

/**
 * Find the largest free rectangle inside `zone` after subtracting any
 * `obstacles`. Returns null if the entire zone is obstructed (or the
 * largest free rect is too tiny to be useful).
 */
function bestRectInZone(
  zone: InternalRect,
  obstacles: OtherWindow[],
  inset: number,
): WindowGeometry | null {
  const free = largestFreeRectInZone(zone, obstacles);
  if (!free) return null;
  if (free.w < MIN_ZONE_W || free.h < MIN_ZONE_H) return null;
  // Apply the visual inset gutter so the preview reads as a window.
  return {
    x: free.x + inset,
    y: free.y + inset,
    w: Math.max(0, free.w - 2 * inset),
    h: Math.max(0, free.h - 2 * inset),
  };
}

/**
 * Largest axis-aligned rectangle inside `zone` that doesn't overlap any
 * obstacle. Algorithm: decompose the zone into a grid using each
 * obstacle's intersecting edges, mark cells free / obstructed by their
 * midpoint, run histogram-style max-rectangle on the binary grid.
 */
export function largestFreeRectInZone(
  zone: InternalRect,
  obstacles: OtherWindow[],
): InternalRect | null {
  if (zone.w <= 0 || zone.h <= 0) return null;
  const ints: InternalRect[] = [];
  for (const o of obstacles) {
    const i = intersect(zone, o);
    if (i) ints.push(i);
  }
  if (ints.length === 0) return zone;

  const xsSet = new Set<number>([zone.x, zone.x + zone.w]);
  const ysSet = new Set<number>([zone.y, zone.y + zone.h]);
  for (const i of ints) {
    xsSet.add(i.x);
    xsSet.add(i.x + i.w);
    ysSet.add(i.y);
    ysSet.add(i.y + i.h);
  }
  const xs = [...xsSet].sort((a, b) => a - b);
  const ys = [...ysSet].sort((a, b) => a - b);

  const cols = xs.length - 1;
  const rows = ys.length - 1;
  // free[r][c] = true iff cell is unobstructed.
  const free: boolean[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: boolean[] = [];
    const midY = (ys[r] + ys[r + 1]) / 2;
    for (let c = 0; c < cols; c++) {
      const midX = (xs[c] + xs[c + 1]) / 2;
      let blocked = false;
      for (const i of ints) {
        if (midX > i.x && midX < i.x + i.w && midY > i.y && midY < i.y + i.h) {
          blocked = true;
          break;
        }
      }
      row.push(!blocked);
    }
    free.push(row);
  }
  return maxRectFromGrid(free, xs, ys);
}

/**
 * Max-rectangle in a binary grid (true = free) using histogram method.
 * `xs` / `ys` are the absolute pixel break-lines for the columns / rows.
 */
function maxRectFromGrid(free: boolean[][], xs: number[], ys: number[]): InternalRect | null {
  const rows = free.length;
  if (rows === 0) return null;
  const cols = free[0].length;
  if (cols === 0) return null;

  // For each column build a "running height in pixels" when sweeping
  // rows top-to-bottom. We use the actual y-deltas (not 1 unit each)
  // so the histogram measures real pixels.
  const heights = new Array<number>(cols).fill(0);
  let best: InternalRect | null = null;

  for (let r = 0; r < rows; r++) {
    const rowH = ys[r + 1] - ys[r];
    for (let c = 0; c < cols; c++) {
      heights[c] = free[r][c] ? heights[c] + rowH : 0;
    }
    const candidate = largestRectInHistogram(heights, xs);
    if (candidate && (!best || area(candidate) > area(best))) {
      // The rectangle's bottom is at ys[r+1]; y = bottom - candidate.h
      best = { ...candidate, y: ys[r + 1] - candidate.h };
    }
  }
  if (!best) return null;
  // Sanity: clamp inside the grid box.
  return best;
}

/**
 * Largest rectangle anchored at row-bottom in a histogram. Standard
 * monotonic-stack approach. Returns rect in pixel coords; y is left
 * unset (the caller fills it from the row index).
 */
function largestRectInHistogram(
  heights: number[],
  xs: number[],
): { x: number; w: number; h: number; y: number } | null {
  const stack: number[] = [];
  let best: { x: number; w: number; h: number; y: number } | null = null;
  const n = heights.length;
  for (let i = 0; i <= n; i++) {
    const h = i === n ? 0 : heights[i];
    while (stack.length > 0 && h < heights[stack[stack.length - 1]]) {
      const topIdx = stack.pop()!;
      const topH = heights[topIdx];
      const leftIdx = stack.length === 0 ? 0 : stack[stack.length - 1] + 1;
      const x = xs[leftIdx];
      const w = xs[i] - x;
      if (w > 0 && topH > 0) {
        const cand = { x, w, h: topH, y: 0 };
        if (!best || area(cand) > area(best)) best = cand;
      }
    }
    stack.push(i);
  }
  return best;
}

function area(r: { w: number; h: number }): number {
  return r.w * r.h;
}

function intersect(a: InternalRect, b: OtherWindow): InternalRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  if (right <= x || bottom <= y) return null;
  return { x, y, w: right - x, h: bottom - y };
}

/* ─────────────── resize-snap (fit-to-available) ─────────────── */

/**
 * The 8 compass-direction resize edges, mirrored from `draggable-window`.
 * Kept local so this pure module never imports from React-land.
 */
export type ResizeEdge = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

/** Window descriptor used by resize-snap math — same shape as OtherWindow. */
export interface ResizeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ResizeSnapOptions {
  /** How close (px) the dragged edge must be to its limit before the snap fires. */
  tolerance?: number;
  inset?: number;
}

/**
 * Per-axis "limit" computation: the farthest a given edge can travel
 * before colliding with another window or the canvas boundary. Iterates
 * obstacles whose perpendicular extent overlaps the active window — a
 * window above-and-to-the-right is irrelevant for a right-edge limit if
 * it's vertically out of band.
 */
function computeRightLimit(a: ResizeRect, others: ResizeRect[], canvasWidth: number): number {
  let limit = canvasWidth;
  for (const o of others) {
    if (yOverlap(o, a) && o.x >= a.x + a.w) limit = Math.min(limit, o.x);
  }
  return limit;
}

function computeLeftLimit(a: ResizeRect, others: ResizeRect[], canvasLeft: number): number {
  let limit = canvasLeft;
  for (const o of others) {
    if (yOverlap(o, a) && o.x + o.w <= a.x) limit = Math.max(limit, o.x + o.w);
  }
  return limit;
}

function computeBottomLimit(a: ResizeRect, others: ResizeRect[], canvasHeight: number): number {
  let limit = canvasHeight;
  for (const o of others) {
    if (xOverlap(o, a) && o.y >= a.y + a.h) limit = Math.min(limit, o.y);
  }
  return limit;
}

function computeTopLimit(a: ResizeRect, others: ResizeRect[], canvasTop: number): number {
  let limit = canvasTop;
  for (const o of others) {
    if (xOverlap(o, a) && o.y + o.h <= a.y) limit = Math.max(limit, o.y + o.h);
  }
  return limit;
}

function yOverlap(a: ResizeRect, b: ResizeRect): boolean {
  return a.y < b.y + b.h && b.y < a.y + a.h;
}

function xOverlap(a: ResizeRect, b: ResizeRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w;
}

/**
 * "Fit-to-available" snap suggestion for a window currently being resized.
 *
 * Unlike `detectSnapZone` (which is pointer-based and intended for drag),
 * this anchors the window's *opposite* edges and snaps the moving edge to
 * the next limit — the canvas boundary or the nearest obstacle on the
 * matching axis. The result is a SnapResult shaped exactly like a drag
 * snap so the same overlay component renders both.
 *
 * Edge resize → fills to one limit; opposite edges fixed.
 * Corner resize → fills to BOTH limits (e.g. SE corner → fills right and
 *                 bottom limits simultaneously) which gives "fit to
 *                 available quarter / rectangle".
 *
 * Returns null when the moving edge is already at its limit (no slack
 * left to snap to) or when the window is below MIN_ZONE size after
 * the inset.
 */
export function detectResizeSnap(
  rect: ResizeRect,
  edge: ResizeEdge,
  bounds: CanvasBounds,
  others: ResizeRect[],
  opts: ResizeSnapOptions = {},
): SnapResult | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const tol = opts.tolerance ?? RESIZE_SNAP_TOLERANCE;
  const inset = opts.inset ?? SNAP_INSET;

  const hasN = edge === "n" || edge === "ne" || edge === "nw";
  const hasS = edge === "s" || edge === "se" || edge === "sw";
  const hasE = edge === "e" || edge === "ne" || edge === "se";
  const hasW = edge === "w" || edge === "nw" || edge === "sw";

  // Compute the geometry that fills to each active edge's limit; opposite
  // edges stay anchored at their start position.
  let nextLeft = rect.x;
  let nextTop = rect.y;
  let nextRight = rect.x + rect.w;
  let nextBottom = rect.y + rect.h;
  let snappedAny = false;

  if (hasE) {
    const limit = computeRightLimit(rect, others, bounds.width);
    const slack = limit - (rect.x + rect.w);
    if (slack > 0 && slack <= tol) {
      nextRight = limit;
      snappedAny = true;
    } else {
      return null;
    }
  }
  if (hasW) {
    const limit = computeLeftLimit(rect, others, 0);
    const slack = rect.x - limit;
    if (slack > 0 && slack <= tol) {
      nextLeft = limit;
      snappedAny = true;
    } else {
      return null;
    }
  }
  if (hasS) {
    const limit = computeBottomLimit(rect, others, bounds.height);
    const slack = limit - (rect.y + rect.h);
    if (slack > 0 && slack <= tol) {
      nextBottom = limit;
      snappedAny = true;
    } else {
      return null;
    }
  }
  if (hasN) {
    const limit = computeTopLimit(rect, others, 0);
    const slack = rect.y - limit;
    if (slack > 0 && slack <= tol) {
      nextTop = limit;
      snappedAny = true;
    } else {
      return null;
    }
  }

  if (!snappedAny) return null;

  // Pick the kind that matches what we filled to. Re-using the canvas-edge
  // family means SnapOverlay renders identically.
  const kind: SnapKind = edgeToSnapKind(edge);

  const x = nextLeft + inset;
  const y = nextTop + inset;
  const w = Math.max(0, nextRight - nextLeft - 2 * inset);
  const h = Math.max(0, nextBottom - nextTop - 2 * inset);
  if (w < MIN_ZONE_W || h < MIN_ZONE_H) return null;

  return { kind, geometry: { x, y, w, h } };
}

function edgeToSnapKind(edge: ResizeEdge): SnapKind {
  switch (edge) {
    case "n":
      return "top";
    case "s":
      return "bottom";
    case "e":
      return "right";
    case "w":
      return "left";
    case "ne":
      return "tr";
    case "nw":
      return "tl";
    case "se":
      return "br";
    case "sw":
      return "bl";
  }
}

/**
 * Group-resize partner lookup. Returns the window whose mirrored edge sits
 * within `tol` px of the active window's dragged edge AND whose
 * perpendicular extent overlaps. Edge-only — corners are ambiguous (two
 * perpendicular partners) and out of scope.
 */
export function findResizePartner(
  active: ResizeRect,
  edge: ResizeEdge,
  others: { id: string; rect: ResizeRect }[],
  tol = 4,
): { id: string; partnerEdge: ResizeEdge } | null {
  if (edge !== "n" && edge !== "s" && edge !== "e" && edge !== "w") return null;
  for (const o of others) {
    if (
      edge === "e" &&
      Math.abs(o.rect.x - (active.x + active.w)) <= tol &&
      yOverlap(o.rect, active)
    ) {
      return { id: o.id, partnerEdge: "w" };
    }
    if (
      edge === "w" &&
      Math.abs(o.rect.x + o.rect.w - active.x) <= tol &&
      yOverlap(o.rect, active)
    ) {
      return { id: o.id, partnerEdge: "e" };
    }
    if (
      edge === "s" &&
      Math.abs(o.rect.y - (active.y + active.h)) <= tol &&
      xOverlap(o.rect, active)
    ) {
      return { id: o.id, partnerEdge: "n" };
    }
    if (
      edge === "n" &&
      Math.abs(o.rect.y + o.rect.h - active.y) <= tol &&
      xOverlap(o.rect, active)
    ) {
      return { id: o.id, partnerEdge: "s" };
    }
  }
  return null;
}

/* ─────────────── gap family (unchanged from PR #104) ─────────────── */

function detectGapZone(
  pointer: PointerInCanvas,
  others: OtherWindow[],
  opts: DetectOptions,
): SnapResult | null {
  const tol = GAP_TOLERANCE;
  for (let i = 0; i < others.length; i++) {
    for (let j = i + 1; j < others.length; j++) {
      const gap = gapBetween(others[i], others[j]);
      if (!gap) continue;
      if (gap.w < MIN_GAP_W || gap.h < MIN_GAP_H) continue;
      if (
        pointer.x >= gap.x - tol &&
        pointer.x <= gap.x + gap.w + tol &&
        pointer.y >= gap.y - tol &&
        pointer.y <= gap.y + gap.h + tol
      ) {
        const inset = opts.inset ?? SNAP_INSET;
        return {
          kind: "gap",
          geometry: {
            x: gap.x + inset,
            y: gap.y + inset,
            w: Math.max(0, gap.w - 2 * inset),
            h: Math.max(0, gap.h - 2 * inset),
          },
        };
      }
    }
  }
  return null;
}

function gapBetween(a: OtherWindow, b: OtherWindow): InternalRect | null {
  const aRight = a.x + a.w;
  const aBottom = a.y + a.h;
  const bRight = b.x + b.w;
  const bBottom = b.y + b.h;

  if (aBottom <= b.y) {
    const overlapL = Math.max(a.x, b.x);
    const overlapR = Math.min(aRight, bRight);
    if (overlapR > overlapL) {
      return { x: overlapL, y: aBottom, w: overlapR - overlapL, h: b.y - aBottom };
    }
  } else if (bBottom <= a.y) {
    const overlapL = Math.max(a.x, b.x);
    const overlapR = Math.min(aRight, bRight);
    if (overlapR > overlapL) {
      return { x: overlapL, y: bBottom, w: overlapR - overlapL, h: a.y - bBottom };
    }
  }

  if (aRight <= b.x) {
    const overlapT = Math.max(a.y, b.y);
    const overlapB = Math.min(aBottom, bBottom);
    if (overlapB > overlapT) {
      return { x: aRight, y: overlapT, w: b.x - aRight, h: overlapB - overlapT };
    }
  } else if (bRight <= a.x) {
    const overlapT = Math.max(a.y, b.y);
    const overlapB = Math.min(aBottom, bBottom);
    if (overlapB > overlapT) {
      return { x: bRight, y: overlapT, w: a.x - bRight, h: overlapB - overlapT };
    }
  }

  return null;
}

/* ─────────────── split family (unchanged from PR #104) ─────────────── */

function detectSplitZone(
  pointer: PointerInCanvas,
  others: OtherWindow[],
  opts: DetectOptions,
): SnapResult | null {
  const win = others.find(
    (w) => pointer.x >= w.x && pointer.x <= w.x + w.w && pointer.y >= w.y && pointer.y <= w.y + w.h,
  );
  if (!win) return null;

  const xFrac = (pointer.x - win.x) / win.w;
  const yFrac = (pointer.y - win.y) / win.h;
  const inLeft = xFrac < 1 / 3;
  const inRight = xFrac > 2 / 3;
  const inTop = yFrac < 1 / 3;
  const inBottom = yFrac > 2 / 3;

  const inset = opts.inset ?? SNAP_INSET;

  if (inTop && inLeft) return { kind: "split-tl", geometry: splitRect(win, "tl", inset) };
  if (inTop && inRight) return { kind: "split-tr", geometry: splitRect(win, "tr", inset) };
  if (inBottom && inLeft) return { kind: "split-bl", geometry: splitRect(win, "bl", inset) };
  if (inBottom && inRight) return { kind: "split-br", geometry: splitRect(win, "br", inset) };
  if (inLeft) return { kind: "split-l", geometry: splitRect(win, "l", inset) };
  if (inRight) return { kind: "split-r", geometry: splitRect(win, "r", inset) };
  if (inTop) return { kind: "split-t", geometry: splitRect(win, "t", inset) };
  if (inBottom) return { kind: "split-b", geometry: splitRect(win, "b", inset) };

  return null;
}

function splitRect(
  win: OtherWindow,
  region: "l" | "r" | "t" | "b" | "tl" | "tr" | "bl" | "br",
  inset: number,
): WindowGeometry {
  const halfW = Math.floor(win.w / 2);
  const halfH = Math.floor(win.h / 2);
  const leftX = win.x + inset;
  const rightX = win.x + halfW;
  const topY = win.y + inset;
  const bottomY = win.y + halfH;
  const leftW = Math.max(0, halfW - inset);
  const rightW = Math.max(0, win.w - halfW - inset);
  const topH = Math.max(0, halfH - inset);
  const bottomH = Math.max(0, win.h - halfH - inset);
  const fullW = Math.max(0, win.w - 2 * inset);
  const fullH = Math.max(0, win.h - 2 * inset);

  switch (region) {
    case "l":
      return { x: leftX, y: topY, w: leftW, h: fullH };
    case "r":
      return { x: rightX, y: topY, w: rightW, h: fullH };
    case "t":
      return { x: leftX, y: topY, w: fullW, h: topH };
    case "b":
      return { x: leftX, y: bottomY, w: fullW, h: bottomH };
    case "tl":
      return { x: leftX, y: topY, w: leftW, h: topH };
    case "tr":
      return { x: rightX, y: topY, w: rightW, h: topH };
    case "bl":
      return { x: leftX, y: bottomY, w: leftW, h: bottomH };
    case "br":
      return { x: rightX, y: bottomY, w: rightW, h: bottomH };
  }
}
