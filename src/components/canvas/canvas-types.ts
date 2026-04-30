/**
 * Shared types and tunable constants for the per-item window canvas.
 *
 * Window state lives in localStorage (per-item), so the schema is
 * versioned via `CANVAS_SCHEMA_VERSION`. Bumping that number invalidates
 * old blobs cleanly — we just return null on read and the user gets a
 * fresh canvas (which is acceptable since this is purely UI state).
 */

export const CANVAS_SCHEMA_VERSION = 1;

/** How many windows fit on a single page before the next add spills over. */
export const PAGE_CAP = 6;

/** Default geometry for a freshly-spawned window. */
export const DEFAULT_W = 520;
export const DEFAULT_H = 580;

/** Minimum size enforced by the resize handle. */
export const MIN_W = 320;
export const MIN_H = 240;

/** Per-window stagger when several spawn back-to-back on the same page. */
export const SPAWN_STAGGER = 24;

/** Top toolbar height, in px. */
export const TOOLBAR_H = 48;

/** Discriminator for window kinds. Add a new variant to `WindowState` below alongside any new entry here. */
export type WindowKind = "chat" | "preview";

export interface WindowGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
  minimized?: boolean;
  maximized?: boolean;
}

export type WindowState =
  | { kind: "chat"; sessionId: string }
  | {
      kind: "preview";
      port: number;
      /**
       * Path on the upstream dev server (e.g. `/about`, `/users/42`).
       * Optional + defaults to `/` when absent — adding it does not
       * invalidate persisted blobs since the loader doesn't enumerate
       * fields. The PreviewWindow keeps this in sync with the page's
       * actual URL whenever the previewed app navigates.
       */
      path?: string;
    };

export interface WindowDescriptor {
  id: string;
  page: number;
  geometry: WindowGeometry;
  state: WindowState;
  /** Last unmaximized geometry; restored when toggling maximize off. */
  prevGeometry?: WindowGeometry;
}

export interface CanvasState {
  version: typeof CANVAS_SCHEMA_VERSION;
  windows: WindowDescriptor[];
  currentPage: number;
  /** Window IDs in last-touched-first order; drives z-index. */
  focusOrder: string[];
  /** ms epoch of the last write — used for LRU eviction across items. */
  touched: number;
}

export function emptyCanvasState(): CanvasState {
  return {
    version: CANVAS_SCHEMA_VERSION,
    windows: [],
    currentPage: 0,
    focusOrder: [],
    touched: Date.now(),
  };
}

/** Cross-`<projectSlug>/<itemSlug>` localStorage key for one item's canvas. */
export function canvasStorageKey(projectSlug: string, itemSlug: string): string {
  return `${projectSlug}/${itemSlug}`;
}
