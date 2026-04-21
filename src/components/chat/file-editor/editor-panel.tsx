"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FiAlertTriangle, FiLoader, FiX } from "react-icons/fi";
import { readFile, writeFile, FileApiError } from "@/lib/api";
import { useIsMobile } from "@/lib/use-is-mobile";
import { Z_INDEX } from "@/lib/z-index";
import { clampRectToViewport } from "@/lib/clamp-to-viewport";
import type { FileEntry } from "@/lib/types";
import { BinaryPlaceholder, isBinaryPath } from "./binary-placeholder";
import { CodeMirror } from "./code-mirror";
import { EditorHeader } from "./header";
import { getPanelLayout, setPanelLayout } from "./layout-store";

export interface FileEditorPanelProps {
  file: FileEntry;
  onClose: () => void;
  zIndex?: number;
  onFocus?: () => void;
  /** Panel index in the open-files list (for cascade offset). */
  stackIndex?: number;
  /** Navigate the file browser to a folder. */
  onRevealInBrowser?: (path: string) => void;
}

const MIN_W = 280;
const MIN_H = 200;
const DEFAULT_W = 520;
const DEFAULT_H = 420;

function mapError(err: unknown): string {
  if (err instanceof FileApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

function initialRect(stackIndex: number): { x: number; y: number; w: number; h: number } {
  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  const offset = 24 * (stackIndex ?? 0);
  const x = Math.max(16, vw - DEFAULT_W - 24 - offset);
  const y = Math.max(56, 72 + offset);
  return clampRectToViewport({ x, y, w: DEFAULT_W, h: DEFAULT_H });
}

export function FileEditorPanel({
  file,
  onClose,
  zIndex = Z_INDEX.MODAL,
  onFocus,
  stackIndex = 0,
  onRevealInBrowser,
}: FileEditorPanelProps) {
  const isMobile = useIsMobile();
  const [closing, setClosing] = useState(false);
  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 160);
  }, [closing, onClose]);

  // Load persisted layout once on mount; fall back to cascading default.
  const [rect, setRect] = useState(() => {
    const saved = typeof window !== "undefined" ? getPanelLayout(file.path) : null;
    if (saved) {
      return clampRectToViewport({ x: saved.x, y: saved.y, w: saved.w, h: saved.h });
    }
    return initialRect(stackIndex);
  });
  const [maximized, setMaximized] = useState<boolean>(() => {
    const saved = typeof window !== "undefined" ? getPanelLayout(file.path) : null;
    return saved?.maximized === true;
  });
  const [minimized, setMinimized] = useState<boolean>(() => {
    const saved = typeof window !== "undefined" ? getPanelLayout(file.path) : null;
    return saved?.minimized === true;
  });

  // Persist whenever geometry changes. Debounced via useEffect batch.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setPanelLayout(file.path, {
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      minimized,
      maximized,
    });
  }, [file.path, rect, maximized, minimized]);

  // Re-clamp on viewport resize.
  useEffect(() => {
    if (typeof window === "undefined" || isMobile) return;
    const onResize = () => {
      setRect((prev) => clampRectToViewport(prev));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isMobile]);

  // File content + dirty state.
  const binary = isBinaryPath(file.path);
  const [original, setOriginal] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(!binary);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = !binary && content !== original;

  useEffect(() => {
    if (binary) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    readFile(file.path)
      .then((c) => {
        if (cancelled) return;
        setOriginal(c);
        setContent(c);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(mapError(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file.path, binary]);

  const handleSave = useCallback(async () => {
    if (binary || !dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      await writeFile(file.path, content);
      setOriginal(content);
    } catch (err) {
      setError(mapError(err));
    } finally {
      setSaving(false);
    }
  }, [binary, dirty, saving, file.path, content]);

  // Drag handling — desktop only.
  const dragStart = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const rafId = useRef<number | null>(null);
  const pendingRect = useRef<{ x: number; y: number } | null>(null);

  const onDragStart = useCallback(
    (e: React.PointerEvent) => {
      if (isMobile || maximized) return;
      if (e.button !== 0) return;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      dragStart.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originX: rect.x,
        originY: rect.y,
      };
    },
    [isMobile, maximized, rect.x, rect.y],
  );

  const flushDrag = useCallback(() => {
    rafId.current = null;
    if (!pendingRect.current) return;
    setRect((prev) => {
      const next = { ...prev, x: pendingRect.current!.x, y: pendingRect.current!.y };
      return clampRectToViewport(next);
    });
    pendingRect.current = null;
  }, []);

  const onDragMove = useCallback(
    (e: React.PointerEvent) => {
      const start = dragStart.current;
      if (!start || e.pointerId !== start.pointerId) return;
      pendingRect.current = {
        x: start.originX + (e.clientX - start.startX),
        y: start.originY + (e.clientY - start.startY),
      };
      if (rafId.current === null) {
        rafId.current = requestAnimationFrame(flushDrag);
      }
    },
    [flushDrag],
  );

  const onDragEnd = useCallback((e: React.PointerEvent) => {
    const start = dragStart.current;
    if (!start || e.pointerId !== start.pointerId) return;
    dragStart.current = null;
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    if (pendingRect.current) {
      setRect((prev) => clampRectToViewport({ ...prev, ...pendingRect.current! }));
      pendingRect.current = null;
    }
  }, []);

  // Resize handling (bottom-right corner).
  const resizeStart = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originW: number;
    originH: number;
  } | null>(null);

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      if (isMobile || maximized) return;
      if (e.button !== 0) return;
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      resizeStart.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originW: rect.w,
        originH: rect.h,
      };
    },
    [isMobile, maximized, rect.w, rect.h],
  );

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    const start = resizeStart.current;
    if (!start || e.pointerId !== start.pointerId) return;
    const w = Math.max(MIN_W, start.originW + (e.clientX - start.startX));
    const h = Math.max(MIN_H, start.originH + (e.clientY - start.startY));
    setRect((prev) => clampRectToViewport({ ...prev, w, h }));
  }, []);

  const onResizeEnd = useCallback((e: React.PointerEvent) => {
    const start = resizeStart.current;
    if (!start || e.pointerId !== start.pointerId) return;
    resizeStart.current = null;
  }, []);

  const onToggleMaximize = useCallback(() => {
    setMaximized((v) => !v);
  }, []);

  const handleSegmentClick = useCallback(
    (path: string) => {
      onRevealInBrowser?.(path);
    },
    [onRevealInBrowser],
  );

  // Render minimized pill.
  if (minimized && !isMobile) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        onFocus={onFocus}
        style={{
          position: "fixed",
          left: 12,
          bottom: 12 + stackIndex * 36,
          zIndex,
        }}
        className="flex items-center gap-1.5 rounded-full border border-canvas-border bg-canvas-surface px-3 py-1.5 text-[11px] text-canvas-fg shadow-lg hover:bg-canvas-surface-hover"
        aria-label={`Restore ${file.name}`}
      >
        {file.name}
        {dirty && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-accent" />}
      </button>
    );
  }

  const isMaximized = maximized && !isMobile;
  const panelStyle: React.CSSProperties = isMobile
    ? {
        position: "fixed",
        inset: 0,
        zIndex,
        // visual viewport height handled via CSS var (useVisualViewport already wires this globally).
      }
    : isMaximized
      ? {
          position: "fixed",
          left: 8,
          top: 8,
          right: 8,
          bottom: 8,
          zIndex,
        }
      : {
          position: "fixed",
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          zIndex,
        };

  return (
    <div
      role="dialog"
      aria-label={`Editing ${file.name}`}
      style={panelStyle}
      onMouseDown={onFocus}
      onPointerMove={
        dragStart.current ? onDragMove : resizeStart.current ? onResizeMove : undefined
      }
      onPointerUp={dragStart.current ? onDragEnd : resizeStart.current ? onResizeEnd : undefined}
      onPointerCancel={
        dragStart.current ? onDragEnd : resizeStart.current ? onResizeEnd : undefined
      }
      className={`flex flex-col border border-canvas-border bg-canvas-bg shadow-xl ${
        isMobile ? "" : "rounded-lg"
      } ${closing ? "animate-panel-out" : "animate-panel-in"}`}
    >
      <EditorHeader
        path={file.path}
        dirty={dirty}
        saving={saving}
        maximized={isMaximized}
        hideWindowControls={isMobile}
        onSegmentClick={handleSegmentClick}
        onSave={handleSave}
        onClose={requestClose}
        onMinimize={isMobile ? undefined : () => setMinimized(true)}
        onToggleMaximize={isMobile ? undefined : onToggleMaximize}
        onReveal={
          onRevealInBrowser
            ? () => {
                const parent = file.path.split("/").slice(0, -1).join("/") || "~";
                onRevealInBrowser(parent);
              }
            : undefined
        }
        onDragStart={onDragStart}
      />

      <div className="min-h-0 flex-1 overflow-hidden">
        {loading && (
          <div className="flex h-full items-center justify-center">
            <FiLoader size={16} className="animate-spin text-canvas-muted" />
          </div>
        )}
        {!loading && error && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
            <FiAlertTriangle size={18} className="text-red-400" />
            <p className="max-w-[320px] text-[12px] text-red-400">{error}</p>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setLoading(true);
                readFile(file.path)
                  .then((c) => {
                    setOriginal(c);
                    setContent(c);
                    setLoading(false);
                  })
                  .catch((err) => {
                    setError(mapError(err));
                    setLoading(false);
                  });
              }}
              className="rounded-md bg-accent px-3 py-1 text-[11px] font-medium text-white hover:opacity-90"
            >
              Retry
            </button>
          </div>
        )}
        {!loading && !error && binary && <BinaryPlaceholder file={file} />}
        {!loading && !error && !binary && (
          <CodeMirror value={content} onChange={setContent} path={file.path} onSave={handleSave} />
        )}
      </div>

      {/* Mobile close bar at top-right — header X is the primary. Provide extra
          close affordance within thumb reach. */}
      {isMobile && (
        <button
          type="button"
          onClick={requestClose}
          aria-label="Close editor"
          className="absolute right-2 top-[calc(env(safe-area-inset-top,0)+6px)] z-10 flex h-7 w-7 items-center justify-center rounded-full bg-canvas-bg/80 text-canvas-muted shadow hover:text-canvas-fg"
        >
          <FiX size={14} />
        </button>
      )}

      {/* Resize handle — desktop, not maximized. */}
      {!isMobile && !isMaximized && (
        <div
          onPointerDown={onResizeStart}
          className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize"
          style={{ touchAction: "none" }}
          aria-hidden
        >
          <div className="absolute bottom-1 right-1 h-1.5 w-1.5 border-b-2 border-r-2 border-canvas-muted/40" />
        </div>
      )}
    </div>
  );
}
