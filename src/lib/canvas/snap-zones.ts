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
export const SNAP_INSET = 2;
/** Pointer is allowed this many pixels outside canvas before we give up. */
export const POINTER_TOLERANCE = 32;

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
  const inset = opts.inset ?? SNAP_INSET;

  const nearTop = pointer.y < edgeBand;
  const nearBottom = pointer.y > bounds.height - edgeBand;
  const nearLeft = pointer.x < edgeBand;
  const nearRight = pointer.x > bounds.width - edgeBand;

  const halfW = Math.floor(bounds.width / 2);
  const halfH = Math.floor(bounds.height / 2);

  // Corner zones first — quarter-sized sectors in the canvas.
  if (nearTop && nearLeft) {
    const rect = bestRectInZone({ x: 0, y: 0, w: halfW, h: halfH }, obstacles, inset);
    if (rect) return { kind: "tl", geometry: rect };
  }
  if (nearTop && nearRight) {
    const rect = bestRectInZone(
      { x: halfW, y: 0, w: bounds.width - halfW, h: halfH },
      obstacles,
      inset,
    );
    if (rect) return { kind: "tr", geometry: rect };
  }
  if (nearBottom && nearLeft) {
    const rect = bestRectInZone(
      { x: 0, y: halfH, w: halfW, h: bounds.height - halfH },
      obstacles,
      inset,
    );
    if (rect) return { kind: "bl", geometry: rect };
  }
  if (nearBottom && nearRight) {
    const rect = bestRectInZone(
      { x: halfW, y: halfH, w: bounds.width - halfW, h: bounds.height - halfH },
      obstacles,
      inset,
    );
    if (rect) return { kind: "br", geometry: rect };
  }

  // Edge zones — half-sized sectors covering one half of the canvas.
  if (nearLeft) {
    const rect = bestRectInZone({ x: 0, y: 0, w: halfW, h: bounds.height }, obstacles, inset);
    if (rect) return { kind: "left", geometry: rect };
  }
  if (nearRight) {
    const rect = bestRectInZone(
      { x: halfW, y: 0, w: bounds.width - halfW, h: bounds.height },
      obstacles,
      inset,
    );
    if (rect) return { kind: "right", geometry: rect };
  }
  if (nearTop) {
    const rect = bestRectInZone({ x: 0, y: 0, w: bounds.width, h: halfH }, obstacles, inset);
    if (rect) return { kind: "top", geometry: rect };
  }
  if (nearBottom) {
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
