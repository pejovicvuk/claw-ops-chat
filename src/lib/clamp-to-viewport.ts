/**
 * Clamp a box to the visible viewport, leaving `margin` px around each
 * edge. Pure function — callers pass measured `width`/`height` so this
 * works for both fixed-position inline styles and transform-based drags.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clampRectToViewport(
  rect: Rect,
  viewport: { w: number; h: number } = {
    w: typeof window === "undefined" ? 0 : window.innerWidth,
    h: typeof window === "undefined" ? 0 : window.innerHeight,
  },
  margin = 8,
): Rect {
  const maxX = Math.max(margin, viewport.w - rect.w - margin);
  const maxY = Math.max(margin, viewport.h - rect.h - margin);
  return {
    x: Math.max(margin, Math.min(rect.x, maxX)),
    y: Math.max(margin, Math.min(rect.y, maxY)),
    w: rect.w,
    h: rect.h,
  };
}

/**
 * Clamp a DOM element in place. Reads its bounding rect, computes a
 * clamped x/y, writes it back to `style.left/top`. Used by the panel
 * after resize/reflow.
 */
export function clampElementToViewport(el: HTMLElement, margin = 8): void {
  if (typeof window === "undefined") return;
  const rect = el.getBoundingClientRect();
  const clamped = clampRectToViewport(
    { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
    undefined,
    margin,
  );
  el.style.left = `${clamped.x}px`;
  el.style.top = `${clamped.y}px`;
}
