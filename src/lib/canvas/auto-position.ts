import {
  DEFAULT_H,
  DEFAULT_W,
  PAGE_CAP,
  SPAWN_STAGGER,
  type CanvasState,
  type WindowGeometry,
} from "@/components/canvas/canvas-types";

/**
 * Pure positioning helpers for the canvas. Kept in `src/lib/` (not next
 * to the components) so they're testable without React + jsdom and
 * cheap to reason about: in / out only, no DOM.
 */

export interface CanvasViewport {
  /** Inner width of the canvas surface (excludes toolbar / dock). */
  width: number;
  /** Inner height of the canvas surface (excludes toolbar / dock). */
  height: number;
}

export interface SpawnResult {
  /** Page the new window should land on (0-indexed). */
  page: number;
  geometry: WindowGeometry;
}

/**
 * Compute where a new window should land given the current canvas
 * state and viewport.
 *
 *   - The candidate page is `currentPage` if it has fewer than
 *     `PAGE_CAP` windows, else `currentPage + 1` (overflow).
 *   - Geometry is centered in the viewport, then offset by
 *     `existingOnPage * SPAWN_STAGGER` so quick back-to-back spawns
 *     don't visually stack.
 *   - The result is clamped so the window's bottom-right edge stays
 *     inside the viewport — important for tiny viewports / mobile.
 */
export function nextSpawnGeometry(state: CanvasState, viewport: CanvasViewport): SpawnResult {
  const w = Math.min(DEFAULT_W, Math.max(240, viewport.width - 32));
  const h = Math.min(DEFAULT_H, Math.max(200, viewport.height - 32));

  const currentPageCount = state.windows.filter((win) => win.page === state.currentPage).length;
  const targetPage = currentPageCount < PAGE_CAP ? state.currentPage : state.currentPage + 1;
  const onTargetPage = state.windows.filter((win) => win.page === targetPage).length;

  const stagger = onTargetPage * SPAWN_STAGGER;
  let x = Math.round((viewport.width - w) / 2 + stagger);
  let y = Math.round((viewport.height - h) / 2 + stagger);

  // Clamp to keep the window fully inside the viewport.
  const maxX = Math.max(0, viewport.width - w);
  const maxY = Math.max(0, viewport.height - h);
  x = Math.min(maxX, Math.max(0, x));
  y = Math.min(maxY, Math.max(0, y));

  return { page: targetPage, geometry: { x, y, w, h } };
}

/**
 * Total number of pages currently in use. Always at least 1 — an empty
 * canvas still presents page 0.
 */
export function pageCount(state: CanvasState): number {
  if (state.windows.length === 0) return 1;
  let max = 0;
  for (const win of state.windows) {
    if (win.page > max) max = win.page;
  }
  return max + 1;
}
