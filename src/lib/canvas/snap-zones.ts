import type { WindowGeometry } from "@/components/canvas/canvas-types";

/**
 * Pure snap-zone detection for the per-item canvas.
 *
 * Mirrors the Windows 11 / Aero Snap gesture: dragging a window's title
 * bar near a canvas edge or corner suggests a half-screen / quarter-
 * screen / fullscreen target. The output is a target geometry — the
 * caller decides whether to render a preview overlay, commit on release,
 * etc. Keeping the logic pure makes the geometry trivially testable.
 */

/** How close (px) the pointer must get to an edge to trigger that edge's snap. */
export const EDGE_BAND = 32;

/**
 * The top edge has a smaller, higher-priority band that triggers a full
 * canvas snap (maximize). When the pointer is within this band of the
 * top edge, "max" wins over the otherwise-valid "top half" suggestion.
 */
export const TOP_BAND = 16;

/** Visual gutter from the canvas border so the preview reads as a window. */
export const SNAP_INSET = 2;

export type SnapKind = "max" | "left" | "right" | "top" | "bottom" | "tl" | "tr" | "bl" | "br";

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

interface DetectOptions {
  edgeBand?: number;
  topBand?: number;
  inset?: number;
}

/**
 * Returns the snap target if the pointer is in a snap zone, else null.
 *
 * Priority (most specific first):
 *   1. Top-edge maximize band (within `topBand` of y=0 — fullscreen).
 *   2. Corner zones (within `edgeBand` of two adjacent edges).
 *   3. Edge zones (within `edgeBand` of one edge — half-snap).
 *
 * The `inset` carves a small gutter from the canvas edges so the
 * preview rectangle reads as a window, not a flush fill.
 */
export function detectSnapZone(
  pointer: PointerInCanvas,
  bounds: CanvasBounds,
  opts: DetectOptions = {},
): SnapResult | null {
  const edgeBand = opts.edgeBand ?? EDGE_BAND;
  const topBand = opts.topBand ?? TOP_BAND;
  const inset = opts.inset ?? SNAP_INSET;

  if (bounds.width <= 0 || bounds.height <= 0) return null;
  // Pointer outside canvas — no snap.
  if (pointer.x < 0 || pointer.y < 0 || pointer.x > bounds.width || pointer.y > bounds.height) {
    return null;
  }

  const nearTop = pointer.y < edgeBand;
  const nearBottom = pointer.y > bounds.height - edgeBand;
  const nearLeft = pointer.x < edgeBand;
  const nearRight = pointer.x > bounds.width - edgeBand;

  // 1) Pure-top maximize takes priority over any top-half.
  if (pointer.y < topBand) {
    return { kind: "max", geometry: rectMax(bounds, inset) };
  }

  // 2) Corner zones.
  if (nearTop && nearLeft) return { kind: "tl", geometry: rectQuarter(bounds, "tl", inset) };
  if (nearTop && nearRight) return { kind: "tr", geometry: rectQuarter(bounds, "tr", inset) };
  if (nearBottom && nearLeft) return { kind: "bl", geometry: rectQuarter(bounds, "bl", inset) };
  if (nearBottom && nearRight) return { kind: "br", geometry: rectQuarter(bounds, "br", inset) };

  // 3) Edge halves.
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
  // bottom
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
