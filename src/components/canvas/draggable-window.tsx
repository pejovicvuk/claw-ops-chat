"use client";

import { useCallback, useEffect, useRef } from "react";
import { FiMaximize2, FiMinimize2, FiMinus, FiX } from "react-icons/fi";
import { clampRectToViewport, type Rect } from "@/lib/clamp-to-viewport";
import { MIN_H, MIN_W, type WindowGeometry } from "./canvas-types";

/** All 8 compass directions plus the centre "drag" mode (handled separately). */
export type ResizeEdge = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

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
  /**
   * Drag-tracking hooks consumed by the canvas page to compute snap
   * previews. Optional — when absent the window still drags freely, just
   * without snap suggestions.
   *
   * `onDragMove` receives the window's current clamped rect AND the live
   * pointer position. The rect is what the canvas page reads for the
   * geometry-based canvas-edge snap (any window corner near a canvas
   * corner fires); the pointer is still needed for gap / split detection
   * (which inherently asks "what is the cursor over").
   */
  onDragStart?: () => void;
  onDragMove?: (rect: Rect, clientX: number, clientY: number) => void;
  /**
   * Resize-tracking hooks. Resize uses a geometry-based snap (fit-to-
   * available) instead of a pointer-based one, so it gets its own
   * pipeline. `onResizeStart` fires once with the edge being grabbed;
   * `onResizeMove` fires (RAF-batched) with each new clamped rect.
   * `onDragEnd` is reused on pointer-up — same protocol returns the
   * snap geometry to apply.
   */
  onResizeStart?: (edge: ResizeEdge) => void;
  onResizeMove?: (rect: Rect) => void;
  /**
   * Returns the snap target the page wants to apply on release, or null
   * to commit the pointer-derived geometry as usual. Called once on
   * pointer-up; the window writes the result through `onChange`.
   */
  onDragEnd?: () => WindowGeometry | null;
  children: React.ReactNode;
}

/**
 * Reusable draggable / resizable / minimizable / maximizable window.
 *
 * Eight resize handles (4 edges + 4 corners), all routed through one
 * pointer-event pipeline. The geometry math lives in `resizeFromEdge`
 * so each handle is a couple of lines and adding more is trivial.
 *
 * Pointer-events drag (no library), RAF-batched to avoid layout
 * thrashing. Geometry is clamped to `canvasBounds` so a window can't
 * escape the canvas surface.
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
  onDragStart,
  onDragMove,
  onResizeStart,
  onResizeMove,
  onDragEnd,
  children,
}: DraggableWindowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    mode: "drag" | "resize";
    edge?: ResizeEdge;
    startPointer: { x: number; y: number };
    startRect: Rect;
    pending: Rect | null;
    rafHandle: number | null;
    /** Latest pointer position — flush reads these so onDragMove can pass them through. */
    lastClientX: number;
    lastClientY: number;
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
    if (ds.mode === "resize") {
      // Geometry-based resize-snap: the canvas page reads this rect to
      // compute fit-to-available previews and to mirror to a partner
      // window during group resize.
      onResizeMove?.(clamped);
    } else {
      // Drag: hand the canvas page both the clamped rect (for rect-based
      // canvas-edge snap) and the live pointer (for gap / split snap).
      onDragMove?.(clamped, ds.lastClientX, ds.lastClientY);
    }
    ds.pending = null;
  }, [canvasBounds.height, canvasBounds.width, geometry, onChange, onDragMove, onResizeMove]);

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
      // Stash the latest pointer for flush — used by drag's onDragMove
      // (rect + pointer) so split / gap detection still has live coords.
      ds.lastClientX = e.clientX;
      ds.lastClientY = e.clientY;
      if (ds.mode === "drag") {
        queueRect({ ...ds.startRect, x: ds.startRect.x + dx, y: ds.startRect.y + dy });
      } else if (ds.edge) {
        // Resize: only queue the new rect. The flush callback drives the
        // resize-snap / partner-mirror pipeline via `onResizeMove`. We
        // deliberately don't call `onDragMove` here — pointer-based snap
        // is the wrong intent during a resize gesture.
        queueRect(resizeFromEdge(ds.edge, ds.startRect, dx, dy));
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
      // Drag and resize share the `onDragEnd` protocol: the canvas page
      // returns the snap geometry it wants applied (or null). For drag
      // this is a pointer-based snap; for resize it's a geometry-based
      // fit-to-available snap. The window writes either back through
      // `onChange` and then clears its gesture state.
      dragStateRef.current = null;
      const snap = onDragEnd?.() ?? null;
      if (snap) {
        onChange({ ...geometry, ...snap, maximized: false, minimized: false });
      }
    },
    [flush, geometry, onChange, onDragEnd],
  );

  const beginDrag = useCallback(
    (e: React.PointerEvent, mode: "drag" | "resize", edge?: ResizeEdge) => {
      if (e.button !== 0) return;
      if (isMaximized || isMinimized) return;
      onFocus();
      e.preventDefault();
      try {
        (e.target as Element).setPointerCapture(e.pointerId);
      } catch {
        /* setPointerCapture can throw if element is detached */
      }
      const startRect: Rect = { x: geometry.x, y: geometry.y, w: geometry.w, h: geometry.h };
      dragStateRef.current = {
        pointerId: e.pointerId,
        mode,
        edge,
        startPointer: { x: e.clientX, y: e.clientY },
        startRect,
        pending: null,
        rafHandle: null,
        lastClientX: e.clientX,
        lastClientY: e.clientY,
      };
      if (mode === "drag") {
        // Prime the canvas page with the start rect + initial pointer so
        // it can snapshot bounds and immediately compute the first snap
        // suggestion (e.g. picking up a window that's already in a corner).
        onDragStart?.();
        onDragMove?.(startRect, e.clientX, e.clientY);
      } else if (edge) {
        // Resize uses geometry-based snap detection. The canvas page
        // captures the start geometry + finds a partner window here so
        // it has the start state ready before any move events arrive.
        onResizeStart?.(edge);
      }
    },
    [
      geometry.h,
      geometry.w,
      geometry.x,
      geometry.y,
      isMaximized,
      isMinimized,
      onDragMove,
      onDragStart,
      onFocus,
      onResizeStart,
    ],
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

  // Build one handle factory so each <ResizeHandle> in the JSX below stays
  // a single line. Closes over beginDrag / onPointerMove / onPointerUp.
  const handleFor = (edge: ResizeEdge) => ({
    edge,
    onPointerDown: (e: React.PointerEvent) => beginDrag(e, "resize", edge),
    onPointerMove,
    onPointerUp,
  });

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
      {/*
        Body wrapper is `flex flex-col` so children (e.g. ChatView's outer
        `flex-1` FileDropzone) have a flex parent to grow against.
      */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      {!isMaximized && (
        <>
          {/* Edges first (bottom of stack), corners last (top) so corner
              hit-tests win at the very corner pixel. */}
          <ResizeHandle {...handleFor("n")} />
          <ResizeHandle {...handleFor("e")} />
          <ResizeHandle {...handleFor("s")} />
          <ResizeHandle {...handleFor("w")} />
          <ResizeHandle {...handleFor("nw")} />
          <ResizeHandle {...handleFor("ne")} />
          <ResizeHandle {...handleFor("sw")} />
          <ResizeHandle {...handleFor("se")} />
        </>
      )}
    </div>
  );
}

/* ───────────────────────── resize math ───────────────────────── */

const EDGE_HIT_PX = 12; // px-thick hit zone for each side
const CORNER_HIT_PX = 24; // square hit zone for each corner
/** z-index applied to every handle so internal chat content can never sit above. */
const HANDLE_Z = 10;

/**
 * Translate a pointer delta into the next geometry given which edge /
 * corner is being dragged. Edges that include "n" / "w" need to update
 * x / y AND shrink h / w in lockstep; "s" / "e" only grow / shrink the
 * facing dimension. Min-size enforcement clamps the delta so the
 * shrunk axis can never go below MIN.
 */
function resizeFromEdge(edge: ResizeEdge, start: Rect, dx: number, dy: number): Rect {
  let { x, y, w, h } = start;
  const hasN = edge === "n" || edge === "ne" || edge === "nw";
  const hasS = edge === "s" || edge === "se" || edge === "sw";
  const hasE = edge === "e" || edge === "ne" || edge === "se";
  const hasW = edge === "w" || edge === "nw" || edge === "sw";

  if (hasW) {
    // Drag left → x decreases, w increases. Shrinking via W is bounded
    // by MIN_W: clamp dx so w stays at MIN_W.
    const dxClamped = Math.min(dx, start.w - MIN_W);
    x = start.x + dxClamped;
    w = start.w - dxClamped;
  }
  if (hasE) {
    w = Math.max(MIN_W, start.w + dx);
  }
  if (hasN) {
    const dyClamped = Math.min(dy, start.h - MIN_H);
    y = start.y + dyClamped;
    h = start.h - dyClamped;
  }
  if (hasS) {
    h = Math.max(MIN_H, start.h + dy);
  }
  return { x, y, w, h };
}

/* ───────────────────────── handle component ───────────────────────── */

interface ResizeHandleProps {
  edge: ResizeEdge;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}

/**
 * Per-edge / per-corner resize handle. Sized for fast pointer
 * acquisition without pixel-hunting:
 *
 *   edges (n/e/s/w) → 8 px-thick along their side, occupying the length
 *                     between corner reservations
 *   corners         → 16 × 16 box at each corner, on TOP of the edges
 *                     so the very corner pixel hits the corner handle
 *
 * Corners get a visible diagonal hint via a CSS gradient (SE only —
 * adding gradients to all 4 corners would over-decorate). Edges are
 * invisible until hovered (cursor change is the affordance).
 */
function ResizeHandle({ edge, onPointerDown, onPointerMove, onPointerUp }: ResizeHandleProps) {
  const common = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  };

  // Edge handles: thin strip along one side, with the opposite-axis
  // length running from corner-end to corner-end.
  if (edge === "n") {
    return (
      <span
        {...common}
        aria-label="Resize from top"
        className="absolute top-0 cursor-ns-resize"
        style={{
          left: CORNER_HIT_PX,
          right: CORNER_HIT_PX,
          height: EDGE_HIT_PX,
          zIndex: HANDLE_Z,
        }}
      />
    );
  }
  if (edge === "s") {
    return (
      <span
        {...common}
        aria-label="Resize from bottom"
        className="absolute bottom-0 cursor-ns-resize"
        style={{
          left: CORNER_HIT_PX,
          right: CORNER_HIT_PX,
          height: EDGE_HIT_PX,
          zIndex: HANDLE_Z,
        }}
      />
    );
  }
  if (edge === "e") {
    return (
      <span
        {...common}
        aria-label="Resize from right"
        className="absolute right-0 cursor-ew-resize"
        style={{
          top: CORNER_HIT_PX,
          bottom: CORNER_HIT_PX,
          width: EDGE_HIT_PX,
          zIndex: HANDLE_Z,
        }}
      />
    );
  }
  if (edge === "w") {
    return (
      <span
        {...common}
        aria-label="Resize from left"
        className="absolute left-0 cursor-ew-resize"
        style={{
          top: CORNER_HIT_PX,
          bottom: CORNER_HIT_PX,
          width: EDGE_HIT_PX,
          zIndex: HANDLE_Z,
        }}
      />
    );
  }

  // Corner handles: square hit-box. SE keeps the diagonal grip glyph for
  // visual continuity.
  const cornerStyle: React.CSSProperties = {
    width: CORNER_HIT_PX,
    height: CORNER_HIT_PX,
    zIndex: HANDLE_Z,
  };
  if (edge === "se") {
    return (
      <span
        {...common}
        aria-label="Resize from bottom-right"
        className="absolute bottom-0 right-0 cursor-nwse-resize"
        style={{
          ...cornerStyle,
          background:
            "linear-gradient(135deg, transparent 50%, var(--canvas-muted) 50%, var(--canvas-muted) 60%, transparent 60%, transparent 70%, var(--canvas-muted) 70%, var(--canvas-muted) 80%, transparent 80%)",
          opacity: 0.5,
        }}
      />
    );
  }
  if (edge === "sw") {
    return (
      <span
        {...common}
        aria-label="Resize from bottom-left"
        className="absolute bottom-0 left-0 cursor-nesw-resize"
        style={cornerStyle}
      />
    );
  }
  if (edge === "ne") {
    return (
      <span
        {...common}
        aria-label="Resize from top-right"
        className="absolute top-0 right-0 cursor-nesw-resize"
        style={cornerStyle}
      />
    );
  }
  // edge === "nw"
  return (
    <span
      {...common}
      aria-label="Resize from top-left"
      className="absolute top-0 left-0 cursor-nwse-resize"
      style={cornerStyle}
    />
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
