"use client";

/**
 * Persist per-file editor panel geometry across sessions.
 *
 * One LRU-capped localStorage entry. Reads / writes tolerate storage
 * failures silently (private mode, quota exceeded) — the editor still
 * works, it just won't remember positions.
 */

const KEY = "claw-editor-layout:v1";
const MAX_ENTRIES = 100;

export interface PanelLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  minimized?: boolean;
  maximized?: boolean;
  /** Unix ms of last update — used for LRU eviction. */
  touched: number;
}

type LayoutMap = Record<string, PanelLayout>;

function read(): LayoutMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as LayoutMap;
  } catch {
    return {};
  }
}

function write(map: LayoutMap): void {
  if (typeof window === "undefined") return;
  try {
    // Enforce LRU cap — drop least-recently-touched entries.
    const entries = Object.entries(map);
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => b[1].touched - a[1].touched);
      const trimmed: LayoutMap = {};
      for (let i = 0; i < MAX_ENTRIES; i++) trimmed[entries[i][0]] = entries[i][1];
      localStorage.setItem(KEY, JSON.stringify(trimmed));
      return;
    }
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* out of quota or unavailable — ignore */
  }
}

export function getPanelLayout(path: string): PanelLayout | null {
  const map = read();
  return map[path] ?? null;
}

export function setPanelLayout(path: string, layout: Omit<PanelLayout, "touched">): void {
  const map = read();
  map[path] = { ...layout, touched: Date.now() };
  write(map);
}

export function clearPanelLayout(path: string): void {
  const map = read();
  if (!(path in map)) return;
  delete map[path];
  write(map);
}
