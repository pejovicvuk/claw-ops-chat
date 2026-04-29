"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Z_INDEX } from "@/lib/z-index";
import { detectSnapZone, type OtherWindow, type SnapResult } from "@/lib/canvas/snap-zones";
import { DraggableWindow } from "./draggable-window";
import { DockStrip } from "./dock-strip";
import { WindowHost } from "./window-host";
import { DOCK_H, type WindowDescriptor, type WindowGeometry } from "./canvas-types";
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
}: CanvasPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });

  const [snapState, setSnapState] = useState<SnapResult | null>(null);
  const snapRef = useRef<SnapResult | null>(null);
  const canvasRectRef = useRef<DOMRect | null>(null);
  /** Id of the window currently being dragged — excluded from snap calculations. */
  const draggingIdRef = useRef<string | null>(null);

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
    if (snapState !== null) setSnapState(null);
    return target;
  }, [snapState]);

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
            onDragEnd={handleDragEnd}
          >
            <WindowHost descriptor={win} onSessionCreated={onSessionCreated} />
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
  return win.id;
}
