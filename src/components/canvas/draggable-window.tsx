"use client";

import { useCallback, useEffect, useRef } from "react";
import { FiMaximize2, FiMinimize2, FiMinus, FiX } from "react-icons/fi";
import { clampRectToViewport, type Rect } from "@/lib/clamp-to-viewport";
import { MIN_H, MIN_W, type WindowGeometry } from "./canvas-types";

interface DraggableWindowProps {
  title: string;
  /** Geometry source-of-truth from the canvas state. */
  geometry: WindowGeometry;
  /** prevGeometry (last unmaximized) — used to restore on un-maximize. */
  prevGeometry?: WindowGeometry;
  zIndex: number;
  /** Bounds the window must stay inside (the canvas surface, not the viewport). */
  canvasBounds: { width: number; height: number };
  onChange: (geometry: WindowGeometry, prev?: WindowGeometry) => void;
  onClose: () => void;
  onFocus: () => void;
  children: React.ReactNode;
}

/**
 * Reusable draggable / resizable / minimizable / maximizable window.
 * No content awareness — just chrome + state plumbing. The body lives in
 * `children` so future window kinds drop in without re-implementing
 * pointer math.
 *
 * Pointer-events drag (no library), RAF-batched to avoid layout
 * thrashing during fast drags. Geometry is clamped to `canvasBounds` so
 * a window can't escape the canvas surface.
 */
export function DraggableWindow({
  title,
  geometry,
  prevGeometry,
  zIndex,
  canvasBounds,
  onChange,
  onClose,
  onFocus,
  children,
}: DraggableWindowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    mode: "drag" | "resize";
    startPointer: { x: number; y: number };
    startRect: Rect;
    pending: Rect | null;
    rafHandle: number | null;
  } | null>(null);

  const isMaximized = geometry.maximized === true;
  const isMinimized = geometry.minimized === true;

  const flush = useCallback(() => {
    const ds = dragStateRef.current;
    if (!ds || !ds.pending) return;
    ds.rafHandle = null;
    const clamped = clampRectToViewport(ds.pending, {
      w: canvasBounds.width,
      h: canvasBounds.height,
    });
    onChange({ ...geometry, ...clamped });
    ds.pending = null;
  }, [canvasBounds.height, canvasBounds.width, geometry, onChange]);

  const queueRect = useCallback(
    (next: Rect) => {
      const ds = dragStateRef.current;
      if (!ds) return;
      ds.pending = next;
      if (ds.rafHandle !== null) return;
      ds.rafHandle = requestAnimationFrame(flush);
    },
    [flush],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const ds = dragStateRef.current;
      if (!ds || ds.pointerId !== e.pointerId) return;
      e.preventDefault();
      const dx = e.clientX - ds.startPointer.x;
      const dy = e.clientY - ds.startPointer.y;
      if (ds.mode === "drag") {
        queueRect({ ...ds.startRect, x: ds.startRect.x + dx, y: ds.startRect.y + dy });
      } else {
        queueRect({
          ...ds.startRect,
          w: Math.max(MIN_W, ds.startRect.w + dx),
          h: Math.max(MIN_H, ds.startRect.h + dy),
        });
      }
    },
    [queueRect],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const ds = dragStateRef.current;
      if (!ds || ds.pointerId !== e.pointerId) return;
      e.preventDefault();
      if (ds.rafHandle !== null) {
        cancelAnimationFrame(ds.rafHandle);
        flush();
      }
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch {
        /* releasePointerCapture can throw if element was unmounted */
      }
      dragStateRef.current = null;
    },
    [flush],
  );

  const beginDrag = useCallback(
    (e: React.PointerEvent, mode: "drag" | "resize") => {
      if (e.button !== 0) return;
      if (isMaximized || isMinimized) return;
      onFocus();
      e.preventDefault();
      try {
        (e.target as Element).setPointerCapture(e.pointerId);
      } catch {
        /* setPointerCapture can throw if element is detached */
      }
      dragStateRef.current = {
        pointerId: e.pointerId,
        mode,
        startPointer: { x: e.clientX, y: e.clientY },
        startRect: { x: geometry.x, y: geometry.y, w: geometry.w, h: geometry.h },
        pending: null,
        rafHandle: null,
      };
    },
    [geometry.h, geometry.w, geometry.x, geometry.y, isMaximized, isMinimized, onFocus],
  );

  const handleMaximize = useCallback(() => {
    if (isMaximized && prevGeometry) {
      onChange({ ...prevGeometry, maximized: false }, undefined);
    } else {
      const target: WindowGeometry = {
        x: 0,
        y: 0,
        w: canvasBounds.width,
        h: canvasBounds.height,
        maximized: true,
      };
      onChange(target, geometry);
    }
  }, [canvasBounds.height, canvasBounds.width, geometry, isMaximized, onChange, prevGeometry]);

  const handleMinimize = useCallback(() => {
    onChange({ ...geometry, minimized: true });
  }, [geometry, onChange]);

  // Re-clamp on canvas resize so a window doesn't end up half off-screen
  // when the parent shrinks (e.g. window resize, sidebar toggle).
  useEffect(() => {
    if (isMaximized || isMinimized) return;
    const clamped = clampRectToViewport(
      { x: geometry.x, y: geometry.y, w: geometry.w, h: geometry.h },
      { w: canvasBounds.width, h: canvasBounds.height },
    );
    if (clamped.x !== geometry.x || clamped.y !== geometry.y) {
      onChange({ ...geometry, x: clamped.x, y: clamped.y });
    }
  }, [canvasBounds.height, canvasBounds.width, geometry, isMaximized, isMinimized, onChange]);

  if (isMinimized) {
    // Minimized = the dock owns rendering; this primitive yields nothing.
    return null;
  }

  const rect: Rect = isMaximized
    ? { x: 0, y: 0, w: canvasBounds.width, h: canvasBounds.height }
    : { x: geometry.x, y: geometry.y, w: geometry.w, h: geometry.h };

  return (
    <div
      ref={containerRef}
      onMouseDown={onFocus}
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        zIndex,
      }}
      className="flex flex-col overflow-hidden rounded-xl border border-canvas-border bg-canvas-bg shadow-xl"
    >
      <header
        onPointerDown={(e) => beginDrag(e, "drag")}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="flex h-9 shrink-0 cursor-move select-none items-center justify-between gap-2 border-b border-canvas-border bg-canvas-surface px-3"
      >
        <span className="line-clamp-1 text-[12px] font-medium text-canvas-fg">{title}</span>
        <div className="flex items-center gap-0.5">
          <ChromeButton onClick={handleMinimize} ariaLabel="Minimize">
            <FiMinus size={11} />
          </ChromeButton>
          <ChromeButton onClick={handleMaximize} ariaLabel={isMaximized ? "Restore" : "Maximize"}>
            {isMaximized ? <FiMinimize2 size={11} /> : <FiMaximize2 size={11} />}
          </ChromeButton>
          <ChromeButton onClick={onClose} ariaLabel="Close" hoverDanger>
            <FiX size={12} />
          </ChromeButton>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      {!isMaximized && (
        <span
          onPointerDown={(e) => beginDrag(e, "resize")}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
          style={{
            background:
              "linear-gradient(135deg, transparent 50%, var(--canvas-muted) 50%, var(--canvas-muted) 60%, transparent 60%, transparent 70%, var(--canvas-muted) 70%, var(--canvas-muted) 80%, transparent 80%)",
            opacity: 0.5,
          }}
          aria-label="Resize"
        />
      )}
    </div>
  );
}

function ChromeButton({
  onClick,
  ariaLabel,
  hoverDanger,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  hoverDanger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={`btn-press flex h-6 w-6 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-bg ${
        hoverDanger ? "hover:text-red-500" : "hover:text-canvas-fg"
      }`}
    >
      {children}
    </button>
  );
}
