"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Z_INDEX } from "@/lib/z-index";
import {
  detectResizeSnap,
  detectSnapZone,
  findResizePartner,
  type OtherWindow,
  type ResizeEdge,
  type ResizeRect,
  type SnapResult,
} from "@/lib/canvas/snap-zones";
import { DraggableWindow } from "./draggable-window";
import { DockStrip } from "./dock-strip";
import { WindowHost } from "./window-host";
import {
  DOCK_H,
  MIN_H,
  MIN_W,
  type WindowDescriptor,
  type WindowGeometry,
  type WindowState,
} from "./canvas-types";
import { SnapOverlay } from "./snap-overlay";

interface CanvasPageProps {
  /** All windows on this page (minimized + visible). */
  windows: WindowDescriptor[];
  /** Window IDs in last-touched-first order; first ID renders on top. */
  focusOrder: string[];
  onChange: (id: string, geometry: WindowGeometry, prev?: WindowGeometry) => void;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  onSessionCreated: (id: string, claudeSessionId: string) => void;
  /** Optional in-window state mutation (e.g. preview port edits). */
  onStateChange?: (id: string, patch: Partial<WindowState>) => void;
}

/**
 * Constant z-index for the snap-preview overlay. Has to sit above any
 * dragged window — and the dragged window's z is `FLOATING + N` where
 * `N <= PAGE_CAP`. Picking a fixed +1000 sidesteps the chance of the
 * overlay ending up behind a dragged window if window counts ever grow.
 */
const SNAP_OVERLAY_Z = Z_INDEX.FLOATING + 1000;

/**
 * Renders one page of the canvas: the visible windows (absolute-
 * positioned, z-stacked by `focusOrder`) plus the dock strip for
 * minimized windows. Measures its own bounds via ResizeObserver so
 * children can clamp drag/resize correctly.
 *
 * Owns the snap-preview overlay: while a window is being dragged the
 * page tracks the pointer in canvas-relative coords, runs
 * `detectSnapZone` (with the *other* visible windows passed through
 * for gap / split detection), and renders a translucent rectangle
 * showing where the window will land if released. On release it hands
 * the snap geometry back to the dragging window via the existing
 * `onDragEnd` return-value protocol.
 */
export function CanvasPage({
  windows,
  focusOrder,
  onChange,
  onClose,
  onFocus,
  onSessionCreated,
  onStateChange,
}: CanvasPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });

  const [snapState, setSnapState] = useState<SnapResult | null>(null);
  const snapRef = useRef<SnapResult | null>(null);
  const canvasRectRef = useRef<DOMRect | null>(null);
  /** Id of the window currently being dragged — excluded from snap calculations. */
  const draggingIdRef = useRef<string | null>(null);
  /**
   * Per-resize gesture state: which window is being resized, which edge
   * was grabbed, the start geometries of the active + partner windows
   * (for delta-based mirror math), and the partner's id if any. All
   * cleared on resize-end.
   */
  const resizeStateRef = useRef<{
    activeId: string;
    edge: ResizeEdge;
    activeStart: ResizeRect;
    partnerId: string | null;
    partnerEdge: ResizeEdge | null;
    partnerStart: ResizeRect | null;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBounds({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const minimized = windows.filter((w) => w.geometry.minimized === true);
  const dockHeight = minimized.length > 0 ? DOCK_H : 0;
  const usableBounds = useMemo(
    () => ({ width: bounds.width, height: Math.max(0, bounds.height - dockHeight) }),
    [bounds.width, bounds.height, dockHeight],
  );

  /**
   * Snapshot of the OTHER visible windows on this page in front-to-back
   * focus order — what `detectSnapZone` reads for gap + split detection.
   * Excludes minimized windows and the dragged one.
   */
  const otherWindowsForDrag = useCallback(
    (draggingId: string | null): OtherWindow[] => {
      const visible = windows.filter(
        (w) => !w.geometry.minimized && (draggingId === null || w.id !== draggingId),
      );
      // Sort by focus z-order (frontmost first) so the split detector
      // picks the topmost window under the pointer.
      visible.sort((a, b) => focusOrder.indexOf(a.id) - focusOrder.indexOf(b.id));
      return visible.map((w) => ({
        x: w.geometry.x,
        y: w.geometry.y,
        w: w.geometry.w,
        h: w.geometry.h,
      }));
    },
    [focusOrder, windows],
  );

  const handleRestore = useCallback(
    (id: string) => {
      const target = windows.find((w) => w.id === id);
      if (!target) return;
      onFocus(id);
      onChange(id, { ...target.geometry, minimized: false });
    },
    [onChange, onFocus, windows],
  );

  const handleDragStart = useCallback((id: string) => {
    canvasRectRef.current = containerRef.current?.getBoundingClientRect() ?? null;
    draggingIdRef.current = id;
  }, []);

  const handleDragMove = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRectRef.current;
      if (!rect) return;
      const pointer = { x: clientX - rect.left, y: clientY - rect.top };
      const others = otherWindowsForDrag(draggingIdRef.current);
      const result = detectSnapZone(pointer, usableBounds, { otherWindows: others });
      // Only re-render when the snap kind actually changes — preserves
      // the overlay's CSS transition between zones.
      if (snapRef.current?.kind !== result?.kind) {
        snapRef.current = result;
        setSnapState(result);
      } else {
        snapRef.current = result;
      }
    },
    [otherWindowsForDrag, usableBounds],
  );

  const handleDragEnd = useCallback((): WindowGeometry | null => {
    const target = snapRef.current?.geometry ?? null;
    snapRef.current = null;
    canvasRectRef.current = null;
    draggingIdRef.current = null;
    resizeStateRef.current = null;
    if (snapState !== null) setSnapState(null);
    return target;
  }, [snapState]);

  /**
   * Resize gesture starts: capture the active window's start geometry,
   * find a partner window whose mirrored edge is touching, and remember
   * both for the move handler.
   */
  const handleResizeStart = useCallback(
    (id: string, edge: ResizeEdge) => {
      const active = windows.find((w) => w.id === id);
      if (!active || active.geometry.minimized || active.geometry.maximized) return;
      const activeStart: ResizeRect = {
        x: active.geometry.x,
        y: active.geometry.y,
        w: active.geometry.w,
        h: active.geometry.h,
      };
      // Candidates for partnering: every other visible window on this page.
      const candidates = windows
        .filter((w) => w.id !== id && !w.geometry.minimized)
        .map((w) => ({
          id: w.id,
          rect: { x: w.geometry.x, y: w.geometry.y, w: w.geometry.w, h: w.geometry.h },
        }));
      const partner = findResizePartner(activeStart, edge, candidates);
      const partnerWin = partner ? windows.find((w) => w.id === partner.id) : null;
      resizeStateRef.current = {
        activeId: id,
        edge,
        activeStart,
        partnerId: partner?.id ?? null,
        partnerEdge: partner?.partnerEdge ?? null,
        partnerStart: partnerWin
          ? {
              x: partnerWin.geometry.x,
              y: partnerWin.geometry.y,
              w: partnerWin.geometry.w,
              h: partnerWin.geometry.h,
            }
          : null,
      };
    },
    [windows],
  );

  /**
   * Resize gesture move: passed the active window's clamped rect from
   * the draggable-window flush. Handles two responsibilities:
   *   1. If a partner exists, mirror the active edge's delta to the
   *      partner's matching edge (e.g. A grew right → B shrinks from left
   *      AND moves right by the same amount). Min-size on the partner
   *      caps both windows so the splitter never produces an oversize.
   *   2. Compute `detectResizeSnap` against the active rect and stash
   *      the result for the overlay + the on-end commit.
   */
  const handleResizeMove = useCallback(
    (rect: { x: number; y: number; w: number; h: number }) => {
      const rs = resizeStateRef.current;
      if (!rs) return;

      // ── 1. Partner mirror ──────────────────────────────────────────────
      if (rs.partnerId && rs.partnerStart && rs.partnerEdge) {
        const partner = windows.find((w) => w.id === rs.partnerId);
        const dx = rect.x - rs.activeStart.x;
        const dy = rect.y - rs.activeStart.y;
        const dw = rect.w - rs.activeStart.w;
        const dh = rect.h - rs.activeStart.h;
        let next: ResizeRect = { ...rs.partnerStart };
        switch (rs.partnerEdge) {
          case "w":
            // Active grew right (E edge) → partner shrinks from left and shifts right.
            next = {
              ...rs.partnerStart,
              x: rs.partnerStart.x + dw,
              w: rs.partnerStart.w - dw,
            };
            break;
          case "e":
            // Active grew left (W edge) → partner shrinks from right.
            next = {
              ...rs.partnerStart,
              w: rs.partnerStart.w + dx,
            };
            break;
          case "n":
            // Active grew down (S edge) → partner shrinks from top and shifts down.
            next = {
              ...rs.partnerStart,
              y: rs.partnerStart.y + dh,
              h: rs.partnerStart.h - dh,
            };
            break;
          case "s":
            // Active grew up (N edge) → partner shrinks from bottom.
            next = {
              ...rs.partnerStart,
              h: rs.partnerStart.h + dy,
            };
            break;
        }
        // Clamp partner to MIN sizes — don't propagate the clamp back to
        // the active window in this MVP (the splitter feels close enough
        // and avoids fighting the active resize math).
        next.w = Math.max(MIN_W, next.w);
        next.h = Math.max(MIN_H, next.h);
        if (
          partner &&
          (next.x !== partner.geometry.x ||
            next.y !== partner.geometry.y ||
            next.w !== partner.geometry.w ||
            next.h !== partner.geometry.h)
        ) {
          onChange(rs.partnerId, { ...partner.geometry, ...next });
        }
      }

      // ── 2. Resize snap suggestion ──────────────────────────────────────
      // Build the obstacle set from every other visible window EXCEPT
      // the partner — the partner's edge is moving in lockstep so it
      // shouldn't bound the active window's snap reach.
      const obstacles: ResizeRect[] = windows
        .filter((w) => w.id !== rs.activeId && w.id !== rs.partnerId && !w.geometry.minimized)
        .map((w) => ({ x: w.geometry.x, y: w.geometry.y, w: w.geometry.w, h: w.geometry.h }));
      const result = detectResizeSnap(rect, rs.edge, usableBounds, obstacles);
      if (snapRef.current?.kind !== result?.kind) {
        snapRef.current = result;
        setSnapState(result);
      } else {
        snapRef.current = result;
      }
    },
    [onChange, usableBounds, windows],
  );

  return (
    <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden bg-canvas-bg">
      {/* Subtle dot grid so it reads as a "canvas" rather than a blank pane. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(var(--canvas-border) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          opacity: 0.4,
        }}
      />
      {windows.map((win) => {
        if (win.geometry.minimized) return null;
        const focusIndex = focusOrder.indexOf(win.id);
        const z = Z_INDEX.FLOATING + Math.max(0, windows.length - focusIndex);
        return (
          <DraggableWindow
            key={win.id}
            title={titleFor(win)}
            geometry={win.geometry}
            prevGeometry={win.prevGeometry}
            zIndex={z}
            canvasBounds={usableBounds}
            onChange={(geom, prev) => onChange(win.id, geom, prev)}
            onClose={() => onClose(win.id)}
            onFocus={() => onFocus(win.id)}
            onDragStart={() => handleDragStart(win.id)}
            onDragMove={handleDragMove}
            onResizeStart={(edge) => handleResizeStart(win.id, edge)}
            onResizeMove={handleResizeMove}
            onDragEnd={handleDragEnd}
          >
            <WindowHost
              descriptor={win}
              onSessionCreated={onSessionCreated}
              onStateChange={onStateChange}
            />
          </DraggableWindow>
        );
      })}
      <SnapOverlay snap={snapState} zIndex={SNAP_OVERLAY_Z} />
      <DockStrip windows={minimized} onRestore={handleRestore} />
    </div>
  );
}

function titleFor(win: WindowDescriptor): string {
  if (win.state.kind === "chat") {
    if (win.state.sessionId.startsWith("new-")) return "New chat";
    return `Chat · ${win.state.sessionId.slice(0, 8)}`;
  }
  if (win.state.kind === "preview") return `Preview · :${win.state.port}`;
  return win.id;
}
