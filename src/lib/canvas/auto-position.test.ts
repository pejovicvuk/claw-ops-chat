import { describe, expect, it } from "vitest";
import {
  DEFAULT_H,
  DEFAULT_W,
  PAGE_CAP,
  SPAWN_STAGGER,
  emptyCanvasState,
  type CanvasState,
  type WindowDescriptor,
} from "@/components/canvas/canvas-types";
import { nextSpawnGeometry, pageCount } from "./auto-position";

const VIEWPORT_LARGE = { width: 1280, height: 800 };
const VIEWPORT_TINY = { width: 400, height: 320 };

function descriptor(id: string, page: number): WindowDescriptor {
  return {
    id,
    page,
    geometry: { x: 0, y: 0, w: DEFAULT_W, h: DEFAULT_H },
    state: { kind: "chat", sessionId: id },
  };
}

function stateWithWindows(pages: Array<{ page: number; count: number }>): CanvasState {
  const windows: WindowDescriptor[] = [];
  for (const p of pages) {
    for (let i = 0; i < p.count; i++) {
      windows.push(descriptor(`p${p.page}-${i}`, p.page));
    }
  }
  return { ...emptyCanvasState(), windows };
}

describe("nextSpawnGeometry", () => {
  it("centers a fresh window on an empty canvas", () => {
    const result = nextSpawnGeometry(emptyCanvasState(), VIEWPORT_LARGE);
    expect(result.page).toBe(0);
    expect(result.geometry.w).toBe(DEFAULT_W);
    expect(result.geometry.h).toBe(DEFAULT_H);
    expect(result.geometry.x).toBe(Math.round((1280 - DEFAULT_W) / 2));
    expect(result.geometry.y).toBe(Math.round((800 - DEFAULT_H) / 2));
  });

  it("staggers each subsequent spawn on the same page", () => {
    const a = nextSpawnGeometry(emptyCanvasState(), VIEWPORT_LARGE);
    const oneOpen: CanvasState = {
      ...emptyCanvasState(),
      windows: [descriptor("a", 0)],
    };
    const b = nextSpawnGeometry(oneOpen, VIEWPORT_LARGE);
    expect(b.page).toBe(0);
    expect(b.geometry.x).toBe(a.geometry.x + SPAWN_STAGGER);
    expect(b.geometry.y).toBe(a.geometry.y + SPAWN_STAGGER);
  });

  it("overflows to the next page once PAGE_CAP is reached", () => {
    const full = stateWithWindows([{ page: 0, count: PAGE_CAP }]);
    const result = nextSpawnGeometry(full, VIEWPORT_LARGE);
    expect(result.page).toBe(1);
    // Page-2 spawn is centered (no other windows on page 1) — same as a fresh canvas.
    const fresh = nextSpawnGeometry(emptyCanvasState(), VIEWPORT_LARGE);
    expect(result.geometry.x).toBe(fresh.geometry.x);
    expect(result.geometry.y).toBe(fresh.geometry.y);
  });

  it("only counts the current page when deciding overflow", () => {
    // PAGE_CAP windows on page 0, but currentPage = 1 with 2 windows.
    const state: CanvasState = {
      ...stateWithWindows([
        { page: 0, count: PAGE_CAP },
        { page: 1, count: 2 },
      ]),
      currentPage: 1,
    };
    const result = nextSpawnGeometry(state, VIEWPORT_LARGE);
    // Page 1 has room (2 of PAGE_CAP), so it lands there.
    expect(result.page).toBe(1);
  });

  it("caps width/height to fit a tiny viewport", () => {
    const result = nextSpawnGeometry(emptyCanvasState(), VIEWPORT_TINY);
    expect(result.geometry.w).toBeLessThanOrEqual(VIEWPORT_TINY.width);
    expect(result.geometry.h).toBeLessThanOrEqual(VIEWPORT_TINY.height);
    expect(result.geometry.x).toBeGreaterThanOrEqual(0);
    expect(result.geometry.y).toBeGreaterThanOrEqual(0);
    expect(result.geometry.x + result.geometry.w).toBeLessThanOrEqual(VIEWPORT_TINY.width);
    expect(result.geometry.y + result.geometry.h).toBeLessThanOrEqual(VIEWPORT_TINY.height);
  });

  it("doesn't push the window below the viewport when many siblings stagger it", () => {
    // Five staggered spawns at 24px/each + a default-size window would
    // run off the bottom on a small viewport. The clamp must catch it.
    const state = stateWithWindows([{ page: 0, count: 5 }]);
    const result = nextSpawnGeometry(state, { width: 700, height: 600 });
    expect(result.geometry.x + result.geometry.w).toBeLessThanOrEqual(700);
    expect(result.geometry.y + result.geometry.h).toBeLessThanOrEqual(600);
  });
});

describe("pageCount", () => {
  it("returns 1 for an empty canvas", () => {
    expect(pageCount(emptyCanvasState())).toBe(1);
  });

  it("returns max(page) + 1 when windows exist", () => {
    const state = stateWithWindows([
      { page: 0, count: 2 },
      { page: 2, count: 1 },
    ]);
    expect(pageCount(state)).toBe(3);
  });
});
