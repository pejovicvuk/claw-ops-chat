"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Z_INDEX } from "@/lib/z-index";
import {
  applyLineDelta,
  detectDragRectSnap,
  detectResizeSnap,
  detectSnapZone,
  findResizeGroup,
  lineShift,
  type GroupMember,
  type OtherWindow,
  type ResizeEdge,
  type ResizeRect,
  type SnapResult,
} from "@/lib/canvas/snap-zones";
import { DraggableWindow } from "./draggable-window";
import { WindowHost } from "./window-host";
import {
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
 * Renders one page of the canvas: visible windows (absolute-positioned,
 * z-stacked by `focusOrder`). Minimized windows render as toolbar tabs
 * at a higher level. Layout is two nested divs:
 *   • outer (`bg-canvas-bg` + dot grid) provides the visual canvas
 *     surface and the 8 px gutter on every side via `inset-2` on the
 *     inner positioning container.
 *   • inner (the positioning container, ResizeObserver target) is
 *     where windows are absolute-positioned. Its size is what
 *     `clampRectToViewport` uses, so a maximized / full-size window
 *     never touches the literal canvas frame.
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
   * was grabbed, the active's start geometry, and the FULL group of
   * partner windows whose moving edge sits on the same shared line.
   * Cleared on resize-end. The group can have N members (chained case)
   * or zero (solo resize).
   */
  const resizeStateRef = useRef<{
    activeId: string;
    edge: ResizeEdge;
    activeStart: ResizeRect;
    group: GroupMember[];
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

  // The inner positioning container provides the usable canvas area.
  // Its measured size already excludes the 8 px gutter on every side, so
  // clampRectToViewport / snap math treat the gutter as the canvas frame.
  const usableBounds = useMemo(
    () => ({ width: bounds.width, height: bounds.height }),
    [bounds.width, bounds.height],
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

  const handleDragStart = useCallback((id: string) => {
    canvasRectRef.current = containerRef.current?.getBoundingClientRect() ?? null;
    draggingIdRef.current = id;
  }, []);

  const handleDragMove = useCallback(
    (rect: ResizeRect, clientX: number, clientY: number) => {
      const cr = canvasRectRef.current;
      if (!cr) return;
      const others = otherWindowsForDrag(draggingIdRef.current);

      // Rect-based first: any window corner / edge near a canvas corner
      // / edge fires the canvas-edge family.
      let result: SnapResult | null = detectDragRectSnap(rect, usableBounds, {
        otherWindows: others,
      });

      // Fall back to pointer-based detection for gap / split — those are
      // inherently "what is the cursor over" and not derivable from the
      // dragged window's geometry.
      if (!result) {
        const pointer = { x: clientX - cr.left, y: clientY - cr.top };
        result = detectSnapZone(pointer, usableBounds, { otherWindows: others });
      }

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
   * find ALL group members (other windows on the active's shared line),
   * and remember everything so `handleResizeMove` can apply a single
   * line-delta to every member of the group.
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
      const candidates = windows
        .filter((w) => w.id !== id && !w.geometry.minimized)
        .map((w) => ({
          id: w.id,
          rect: { x: w.geometry.x, y: w.geometry.y, w: w.geometry.w, h: w.geometry.h },
        }));
      const group = findResizeGroup(activeStart, edge, candidates);
      resizeStateRef.current = { activeId: id, edge, activeStart, group };
    },
    [windows],
  );

  /**
   * Resize gesture move: passed the active window's clamped rect from
   * the draggable-window flush. Two responsibilities:
   *   1. Compute the line shift Δ from the active's geometry, then
   *      apply Δ to every group member via `applyLineDelta`. Each
   *      member's geometry is clamped to MIN_W / MIN_H individually
   *      (no rollback to the active in this MVP).
   *   2. Compute `detectResizeSnap` against the active rect and stash
   *      the result for the overlay + the on-end commit.
   */
  const handleResizeMove = useCallback(
    (rect: { x: number; y: number; w: number; h: number }) => {
      const rs = resizeStateRef.current;
      if (!rs) return;

      // ── 1. Group mirror ────────────────────────────────────────────────
      const delta = lineShift(rect, rs.activeStart, rs.edge);
      for (const member of rs.group) {
        const next = applyLineDelta(member.start, member.role, rs.edge, delta);
        next.w = Math.max(MIN_W, next.w);
        next.h = Math.max(MIN_H, next.h);
        const current = windows.find((w) => w.id === member.id);
        if (
          current &&
          (next.x !== current.geometry.x ||
            next.y !== current.geometry.y ||
            next.w !== current.geometry.w ||
            next.h !== current.geometry.h)
        ) {
          onChange(member.id, { ...current.geometry, ...next });
        }
      }

      // ── 2. Resize snap suggestion ──────────────────────────────────────
      // Build the obstacle set from every other visible window EXCEPT
      // group members — their edges are moving in lockstep so they
      // shouldn't bound the active window's snap reach.
      const groupIds = new Set(rs.group.map((m) => m.id));
      const obstacles: ResizeRect[] = windows
        .filter((w) => w.id !== rs.activeId && !groupIds.has(w.id) && !w.geometry.minimized)
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
    <div className="relative min-h-0 flex-1 overflow-hidden bg-canvas-bg">
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
      {/*
        Inner positioning container — provides the 8 px gutter on every
        side. ResizeObserver measures THIS so usableBounds / clamp math
        treat the gutter as the canvas frame; full-size windows never
        touch the literal edge.
      */}
      <div ref={containerRef} className="absolute inset-2">
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
      </div>
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
