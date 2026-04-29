import type { WindowGeometry } from "@/components/canvas/canvas-types";

/**
 * Smart snap-zone detection for the per-item canvas.
 *
 * Layers three increasingly specific zone families behind one entry point:
 *
 *   1. Canvas edges  — Aero-Snap-style halves / quarters / max along the
 *                      4 outer edges. Wins when the pointer is in an
 *                      outer hot-zone band.
 *   2. Inter-window gaps — when the pointer is between two existing
 *                      windows along a horizontal or vertical axis,
 *                      suggest filling the gap rectangle. Picks up the
 *                      "drag between two stacked windows" gesture.
 *   3. Window splits — pointer hovering OVER an existing window suggests
 *                      a half/quarter of THAT window's bounds. Lets the
 *                      user "drop into" any cell of the layout.
 *
 * All math is pure (no DOM, no React) so each family has its own table-
 * driven test cases.
 */

export const EDGE_BAND = 32;
export const TOP_BAND = 16;
export const SNAP_INSET = 2;

/** Tolerance (px) around an inter-window gap so the pointer doesn't have to be pixel-perfect. */
export const GAP_TOLERANCE = 16;

/** Minimum gap dimensions before we'll suggest filling — anything smaller is just visual noise. */
export const MIN_GAP_W = 80;
export const MIN_GAP_H = 80;

export type SnapKind =
  // Canvas-edge zones
  | "max"
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
  topBand?: number;
  inset?: number;
  /** Other visible windows on the active page, EXCLUDING the dragged one. */
  otherWindows?: OtherWindow[];
}

/**
 * Returns the most specific snap suggestion for the pointer, or null.
 *
 * Priority order: canvas-edge → gap → split. Earlier families short-
 * circuit later ones; gaps only fire when the pointer is *between*
 * windows; splits only fire when the pointer is *inside* a window.
 */
export function detectSnapZone(
  pointer: PointerInCanvas,
  bounds: CanvasBounds,
  opts: DetectOptions = {},
): SnapResult | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  if (pointer.x < 0 || pointer.y < 0 || pointer.x > bounds.width || pointer.y > bounds.height) {
    return null;
  }

  const edge = detectCanvasEdgeZone(pointer, bounds, opts);
  if (edge) return edge;

  const others = opts.otherWindows ?? [];
  if (others.length > 0) {
    const gap = detectGapZone(pointer, others, opts);
    if (gap) return gap;

    const split = detectSplitZone(pointer, others, opts);
    if (split) return split;
  }

  return null;
}

/* ─────────────── canvas-edge family ─────────────── */

function detectCanvasEdgeZone(
  pointer: PointerInCanvas,
  bounds: CanvasBounds,
  opts: DetectOptions,
): SnapResult | null {
  const edgeBand = opts.edgeBand ?? EDGE_BAND;
  const topBand = opts.topBand ?? TOP_BAND;
  const inset = opts.inset ?? SNAP_INSET;

  const nearTop = pointer.y < edgeBand;
  const nearBottom = pointer.y > bounds.height - edgeBand;
  const nearLeft = pointer.x < edgeBand;
  const nearRight = pointer.x > bounds.width - edgeBand;

  if (pointer.y < topBand) return { kind: "max", geometry: rectMax(bounds, inset) };

  if (nearTop && nearLeft) return { kind: "tl", geometry: rectQuarter(bounds, "tl", inset) };
  if (nearTop && nearRight) return { kind: "tr", geometry: rectQuarter(bounds, "tr", inset) };
  if (nearBottom && nearLeft) return { kind: "bl", geometry: rectQuarter(bounds, "bl", inset) };
  if (nearBottom && nearRight) return { kind: "br", geometry: rectQuarter(bounds, "br", inset) };

  if (nearLeft) return { kind: "left", geometry: rectHalf(bounds, "left", inset) };
  if (nearRight) return { kind: "right", geometry: rectHalf(bounds, "right", inset) };
  if (nearTop) return { kind: "top", geometry: rectHalf(bounds, "top", inset) };
  if (nearBottom) return { kind: "bottom", geometry: rectHalf(bounds, "bottom", inset) };

  return null;
}

function rectMax(b: CanvasBounds, inset: number): WindowGeometry {
  return {
    x: inset,
    y: inset,
    w: Math.max(0, b.width - 2 * inset),
    h: Math.max(0, b.height - 2 * inset),
  };
}

function rectHalf(
  b: CanvasBounds,
  side: "left" | "right" | "top" | "bottom",
  inset: number,
): WindowGeometry {
  const halfW = Math.floor(b.width / 2);
  const halfH = Math.floor(b.height / 2);
  if (side === "left") {
    return {
      x: inset,
      y: inset,
      w: Math.max(0, halfW - inset),
      h: Math.max(0, b.height - 2 * inset),
    };
  }
  if (side === "right") {
    return {
      x: halfW,
      y: inset,
      w: Math.max(0, b.width - halfW - inset),
      h: Math.max(0, b.height - 2 * inset),
    };
  }
  if (side === "top") {
    return {
      x: inset,
      y: inset,
      w: Math.max(0, b.width - 2 * inset),
      h: Math.max(0, halfH - inset),
    };
  }
  return {
    x: inset,
    y: halfH,
    w: Math.max(0, b.width - 2 * inset),
    h: Math.max(0, b.height - halfH - inset),
  };
}

function rectQuarter(
  b: CanvasBounds,
  corner: "tl" | "tr" | "bl" | "br",
  inset: number,
): WindowGeometry {
  const halfW = Math.floor(b.width / 2);
  const halfH = Math.floor(b.height / 2);
  const leftW = Math.max(0, halfW - inset);
  const rightW = Math.max(0, b.width - halfW - inset);
  const topH = Math.max(0, halfH - inset);
  const bottomH = Math.max(0, b.height - halfH - inset);
  if (corner === "tl") return { x: inset, y: inset, w: leftW, h: topH };
  if (corner === "tr") return { x: halfW, y: inset, w: rightW, h: topH };
  if (corner === "bl") return { x: inset, y: halfH, w: leftW, h: bottomH };
  return { x: halfW, y: halfH, w: rightW, h: bottomH };
}

/* ─────────────── gap family ─────────────── */

/**
 * Detect "fill the gap between two adjacent windows" zones. For every
 * pair of `otherWindows` that share a non-trivial overlap on one axis
 * with a clear gap on the other axis, we produce a candidate gap
 * rectangle. The pointer-containing candidate (with `GAP_TOLERANCE`
 * slack) wins.
 *
 * Two pairs are considered:
 *   - vertical neighbours (one above the other, sharing x-overlap)
 *   - horizontal neighbours (one beside the other, sharing y-overlap)
 *
 * Trivial gaps (< MIN_GAP_W × MIN_GAP_H) are skipped — anything smaller
 * isn't worth showing as a snap target, the window wouldn't fit cleanly.
 */
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

interface GapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Compute the gap rectangle between two windows, or null if they aren't a clean vertical / horizontal pair. */
function gapBetween(a: OtherWindow, b: OtherWindow): GapRect | null {
  const aRight = a.x + a.w;
  const aBottom = a.y + a.h;
  const bRight = b.x + b.w;
  const bBottom = b.y + b.h;

  // Vertical pair: one above the other with a horizontal-axis overlap.
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

  // Horizontal pair: side by side with a vertical-axis overlap.
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

/* ─────────────── split family ─────────────── */

/**
 * Detect "drop into half / quarter of an existing window" zones. The
 * pointer's relative position inside the underlying window divides the
 * window into a 3×3 grid (1/3 thresholds). Outer thirds → halves /
 * quarters of that window's bounds; centre-centre → null (dead-zone).
 *
 * Geometry returned is a sub-rectangle of the underlying window, NOT
 * the canvas. Releasing onto a split overlaps the existing window —
 * we don't displace it.
 */
function detectSplitZone(
  pointer: PointerInCanvas,
  others: OtherWindow[],
  opts: DetectOptions,
): SnapResult | null {
  // Pick the topmost window in z-order containing the pointer. Caller is
  // expected to pass `otherWindows` in front-to-back order; we take the
  // first match, which approximates "what the user is hovering over".
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

  // Centre-centre: dead-zone. User probably wants to drop ON TOP of this
  // window, not snap into a fraction of it.
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
