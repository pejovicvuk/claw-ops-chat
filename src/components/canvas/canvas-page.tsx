"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Z_INDEX } from "@/lib/z-index";
import { DraggableWindow } from "./draggable-window";
import { DockStrip } from "./dock-strip";
import { WindowHost } from "./window-host";
import { DOCK_H, type WindowDescriptor, type WindowGeometry } from "./canvas-types";

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
  const usableBounds = { width: bounds.width, height: Math.max(0, bounds.height - dockHeight) };

  const handleRestore = useCallback(
    (id: string) => {
      const target = windows.find((w) => w.id === id);
      if (!target) return;
      onFocus(id);
      onChange(id, { ...target.geometry, minimized: false });
    },
    [onChange, onFocus, windows],
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
          >
            <WindowHost descriptor={win} onSessionCreated={onSessionCreated} />
          </DraggableWindow>
        );
      })}
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
