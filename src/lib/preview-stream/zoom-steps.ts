/**
 * Phase 5b (#132): zoom-step helpers for the preview window's
 * Ctrl+= / Ctrl+- / Ctrl+0 controls. Mirrors the standard Chromium
 * zoom ladder so the UX matches "real browser" zoom.
 *
 * Pure module — all functions are deterministic and side-effect-free,
 * which makes them trivially unit-testable. The `use-preview-stream`
 * hook calls them when intercepting Ctrl+key combos; the toolbar's
 * zoom chip uses `formatZoomPercent` for display.
 */

/**
 * Standard Chromium zoom ladder. Same step set you get when pressing
 * Ctrl+= / Ctrl+- in Chrome. Sorted ascending — `nextZoomIn` walks
 * forward, `nextZoomOut` walks backward.
 */
export const ZOOM_STEPS: readonly number[] = [
  0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0,
];

export const ZOOM_DEFAULT = 1.0;
export const ZOOM_MIN = ZOOM_STEPS[0];
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/**
 * Floating-point comparison tolerance. The zoom ladder is in
 * 0.01-precision steps, but values arriving from `WindowState` may be
 * arbitrary floats. EPS is small enough to disambiguate adjacent
 * steps and large enough to forgive accumulated rounding.
 */
const EPS = 1e-6;

/**
 * Find the smallest step strictly greater than `current`. If
 * `current` is at or above the maximum, returns the maximum unchanged
 * (a no-op zoom-in at the top).
 */
export function nextZoomIn(current: number): number {
  for (const step of ZOOM_STEPS) {
    if (step > current + EPS) return step;
  }
  return ZOOM_MAX;
}

/**
 * Find the largest step strictly less than `current`. If `current`
 * is at or below the minimum, returns the minimum unchanged (a no-op
 * zoom-out at the bottom).
 */
export function nextZoomOut(current: number): number {
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    if (ZOOM_STEPS[i] < current - EPS) return ZOOM_STEPS[i];
  }
  return ZOOM_MIN;
}

/**
 * Clamp an arbitrary factor into the supported range. Used when
 * loading persisted zoom from `WindowState` — older blobs may carry
 * out-of-range values from previous schema versions.
 */
export function clampZoom(factor: number): number {
  if (!Number.isFinite(factor)) return ZOOM_DEFAULT;
  if (factor < ZOOM_MIN) return ZOOM_MIN;
  if (factor > ZOOM_MAX) return ZOOM_MAX;
  return factor;
}

/**
 * Display string for the toolbar chip. Examples:
 *   1.0   → "100%"
 *   1.25  → "125%"
 *   0.67  → "67%"
 *   0.333 → "33%" (rounds-to-nearest at integer percent)
 */
export function formatZoomPercent(factor: number): string {
  return `${Math.round(factor * 100)}%`;
}
