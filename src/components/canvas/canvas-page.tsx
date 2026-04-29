"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Z_INDEX } from "@/lib/z-index";
import { detectSnapZone, type SnapResult } from "@/lib/canvas/snap-zones";
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
 * Renders one page of the canvas: the visible windows (absolute-
 * positioned, z-stacked by `focusOrder`) plus the dock strip for
 * minimized windows. Measures its own bounds via ResizeObserver so
 * children can clamp drag/resize correctly.
 *
 * Owns the snap-preview overlay: while a window is being dragged the
 * page tracks the pointer in canvas-relative coords, runs
 * `detectSnapZone`, and renders a translucent rectangle showing where
 * the window will land if the user releases now. On release it hands
 * the snap geometry back to the dragging window which writes it
 * through `onChange`.
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

  /**
   * Snap state lives in TWO places:
   *   - `snapState`: triggers re-renders of the overlay
   *   - `snapRef`: read synchronously by the dragging window's
   *     `onDragEnd` callback (state updates are async)
   * They're kept in sync — set both whenever the snap suggestion
   * changes.
   */
  const [snapState, setSnapState] = useState<SnapResult | null>(null);
  const snapRef = useRef<SnapResult | null>(null);
  const canvasRectRef = useRef<DOMRect | null>(null);

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
  // Memoized so it's a stable dependency for `handleDragMove`'s callback —
  // otherwise every render rebuilds the function and the snap detection
  // loses the reference identity it needs for React's hook dep checks.
  const usableBounds = useMemo(
    () => ({ width: bounds.width, height: Math.max(0, bounds.height - dockHeight) }),
    [bounds.width, bounds.height, dockHeight],
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

  const handleDragStart = useCallback(() => {
    // Cache the canvas's bounding rect once per drag so subsequent
    // pointer-move events don't pay a layout cost.
    canvasRectRef.current = containerRef.current?.getBoundingClientRect() ?? null;
  }, []);

  const handleDragMove = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRectRef.current;
      if (!rect) return;
      const pointer = { x: clientX - rect.left, y: clientY - rect.top };
      const result = detectSnapZone(pointer, usableBounds);
      // Only re-render when the snap kind actually changes — otherwise
      // every pointer-move tick would invalidate the overlay's CSS
      // transition and we'd lose the smooth slide.
      if (snapRef.current?.kind !== result?.kind) {
        snapRef.current = result;
        setSnapState(result);
      } else {
        snapRef.current = result;
      }
    },
    [usableBounds],
  );

  const handleDragEnd = useCallback((): WindowGeometry | null => {
    const target = snapRef.current?.geometry ?? null;
    snapRef.current = null;
    canvasRectRef.current = null;
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
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
          >
            <WindowHost descriptor={win} onSessionCreated={onSessionCreated} />
          </DraggableWindow>
        );
      })}
      <SnapOverlay snap={snapState} zIndex={Z_INDEX.FLOATING + windows.length + 1} />
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
