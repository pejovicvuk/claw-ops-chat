"use client";

import {
  CANVAS_SCHEMA_VERSION,
  emptyCanvasState,
  type CanvasState,
} from "@/components/canvas/canvas-types";

/**
 * Per-item canvas state persistence — one localStorage entry of shape
 * `Record<itemKey, CanvasState>` with LRU eviction. Mirrors the layout-
 * store pattern for file editor panels: tolerate read/write failures
 * silently (private mode, quota), bump the version key for hard schema
 * breaks.
 */

const KEY = "claw-item-canvas:v1";
const MAX_ENTRIES = 100;

type CanvasMap = Record<string, CanvasState>;

function readMap(): CanvasMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as CanvasMap;
  } catch {
    return {};
  }
}

function writeMap(map: CanvasMap): void {
  if (typeof window === "undefined") return;
  try {
    const entries = Object.entries(map);
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => b[1].touched - a[1].touched);
      const trimmed: CanvasMap = {};
      for (let i = 0; i < MAX_ENTRIES; i++) trimmed[entries[i][0]] = entries[i][1];
      localStorage.setItem(KEY, JSON.stringify(trimmed));
      return;
    }
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* out of quota or unavailable — ignore */
  }
}

/**
 * Returns the saved canvas for `itemKey`, or null if there's none on
 * disk OR if the saved blob is malformed / from an older schema. The
 * caller is expected to fall back to `emptyCanvasState()`.
 */
export function loadCanvas(itemKey: string): CanvasState | null {
  const map = readMap();
  const entry = map[itemKey];
  if (!entry) return null;
  // Reject anything that isn't the current schema; cheap, no migrations
  // for now — invariant is "UI state only, safe to lose on bump".
  if (entry.version !== CANVAS_SCHEMA_VERSION) return null;
  if (!Array.isArray(entry.windows) || !Array.isArray(entry.focusOrder)) return null;
  if (typeof entry.currentPage !== "number") return null;
  return entry;
}

/**
 * Persist the canvas state. Bumps `touched` so the LRU eviction picks
 * the right victim when the store overflows.
 */
export function saveCanvas(itemKey: string, state: CanvasState): void {
  const map = readMap();
  map[itemKey] = { ...state, touched: Date.now() };
  writeMap(map);
}

/** Drop the saved canvas for one item. */
export function clearCanvas(itemKey: string): void {
  const map = readMap();
  if (!(itemKey in map)) return;
  delete map[itemKey];
  writeMap(map);
}

/** Convenience helper: load or fall back to an empty state. */
export function loadCanvasOrEmpty(itemKey: string): CanvasState {
  return loadCanvas(itemKey) ?? emptyCanvasState();
}
