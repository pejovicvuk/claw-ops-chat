"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiAlertTriangle, FiLoader, FiX } from "react-icons/fi";
import { readFile, writeFile, FileApiError } from "@/lib/api";
import { subscribeFileChange } from "@/lib/file-change-bus";
import { isEditableKind, pickRenderer, type PreviewKind } from "@/lib/file-preview/pick-renderer";
import { useDownload } from "@/lib/use-download";
import { useGitDiff } from "@/lib/use-git-diff";
import { useIsMobile } from "@/lib/use-is-mobile";
import { useToast } from "@/lib/use-toast";
import { Z_INDEX } from "@/lib/z-index";
import { clampRectToViewport } from "@/lib/clamp-to-viewport";
import type { DiffAgainst } from "@/lib/git/types";
import type { FileEntry } from "@/lib/types";
import { BinaryPlaceholder } from "./binary-placeholder";
import { CodeMirror } from "./code-mirror";
import { ConflictBanner } from "./conflict-banner";
import { DiffView } from "./diff-view";
import { DownloadProgress } from "./download-progress";
import { EditorHeader, type EditorMode } from "./header";
import { getPanelLayout, setPanelLayout } from "./layout-store";
import { ReadablePreview } from "./readable-preview";

/**
 * State carried while the editor is showing the stale-write banner. The
 * disk version is captured at conflict-detection time so the user can
 * pick "Reload" without a follow-up fetch. `currentContent: null` means
 * the file was deleted on disk; "Reload" in that case clears the buffer.
 */
interface ConflictState {
  currentContent: string | null;
  currentMtimeMs: number | null;
}

type Mode = EditorMode;

/**
 * Session-scoped memory of the last mode + diff target chosen per file
 * path. Reopening the same file mid-session restores the user's last
 * choice for both axes.
 */
interface ModeMemo {
  mode: Mode;
  against: DiffAgainst;
}
const lastModeByPath = new Map<string, ModeMemo>();

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
  const { toast } = useToast();
  const dl = useDownload({ onError: (msg) => toast.error(msg) });
  const handleDownload = useCallback(() => {
    dl.download(file.path);
  }, [dl, file.path]);
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

  // Renderer choice + view/edit mode.
  const choice = useMemo(() => pickRenderer(file.path), [file.path]);
  const kind: PreviewKind = choice.kind;
  const editable = isEditableKind(kind);
  const isMediaOrBinary = !editable;

  const [mode, setMode] = useState<Mode>(() => {
    const saved = lastModeByPath.get(file.path);
    if (saved) return saved.mode;
    return "view";
  });
  const [against, setAgainst] = useState<DiffAgainst>(() => {
    const saved = lastModeByPath.get(file.path);
    return saved?.against ?? "working";
  });
  // Probe whether this file is tracked by git. We always query the
  // working diff once so the Diff segment can show/hide based on real
  // tracking state, not a guess.
  const trackedProbe = useGitDiff(editable ? file.path : "", "working");
  const diffAvailable = editable && trackedProbe.tracked;
  // Bumped after a successful save so DiffView refetches.
  const [diffRefreshKey, setDiffRefreshKey] = useState(0);
  // Force view mode for non-editable kinds (image / pdf / video / audio / binary).
  // Force out of diff mode if the file isn't diffable any more.
  const effectiveMode: Mode = editable
    ? mode === "diff" && !diffAvailable
      ? "view"
      : mode
    : "view";

  // Wrap long lines in code/text view. Defaults: on for mobile readability,
  // off on desktop where horizontal scroll is fine. Persist per-session.
  const [wrap, setWrap] = useState<boolean>(() => isMobile);

  const [original, setOriginal] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [mtimeMs, setMtimeMs] = useState<number | null>(null);
  /**
   * Server-canonicalized realpath returned by `/api/files/read`. Used
   * as the file-change-bus subscription key (server emits realpath
   * too) and as the breadcrumb identity in the header so symlink-
   * traversed opens display the underlying file. Falls back to the
   * caller-supplied `file.path` until the first read completes.
   */
  const [realPath, setRealPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(editable);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const dirty = editable && content !== original;
  // Captured by the file-change subscription so we don't need to
  // re-subscribe on every keystroke; the latest dirty value is read
  // inside the handler at fire time.
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    if (!editable) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setConflict(null);
    readFile(file.path)
      .then((res) => {
        if (cancelled) return;
        setOriginal(res.content);
        setContent(res.content);
        setMtimeMs(res.mtimeMs);
        setRealPath(res.path);
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
  }, [file.path, editable]);

  // Subscribe to server-pushed `file_changed` events for this path.
  // Sources today: Claude's Write/Edit/MultiEdit. When the user has no
  // unsaved local edits we silently re-fetch and toast; with edits we
  // surface the conflict banner pre-emptively (no need to wait for
  // their next save to discover the stale state).
  //
  // Subscribe by realpath when known so symlink-traversed opens still
  // match the server's canonical key (server emits realpath via
  // safePath()). Falls back to the typed path on the first render
  // before the initial read resolves.
  const subscriptionPath = realPath ?? file.path;
  useEffect(() => {
    if (!editable) return;
    let cancelled = false;
    const unsub = subscribeFileChange(subscriptionPath, (event) => {
      if (cancelled) return;
      if (event.deleted) {
        setConflict({ currentContent: null, currentMtimeMs: null });
        return;
      }
      if (dirtyRef.current) {
        // Pull the on-disk version so the banner's Reload button can
        // apply it without a follow-up fetch.
        readFile(file.path)
          .then((res) => {
            if (cancelled) return;
            setConflict({ currentContent: res.content, currentMtimeMs: res.mtimeMs });
          })
          .catch(() => {
            if (cancelled) return;
            setConflict({ currentContent: null, currentMtimeMs: null });
          });
        return;
      }
      // No unsaved edits — auto-reload the buffer.
      readFile(file.path)
        .then((res) => {
          if (cancelled) return;
          setOriginal(res.content);
          setContent(res.content);
          setMtimeMs(res.mtimeMs);
          setRealPath(res.path);
          toast.success("Updated by Claude");
        })
        .catch(() => {
          /* swallow — user's next interaction will surface the issue */
        });
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [subscriptionPath, file.path, editable, toast]);

  const handleSave = useCallback(async () => {
    if (!editable || !dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await writeFile(
        file.path,
        content,
        mtimeMs !== null ? { expectedMtimeMs: mtimeMs } : {},
      );
      setOriginal(content);
      setMtimeMs(res.mtimeMs);
      setConflict(null);
      // Invalidate any cached diff so re-entering Diff mode re-fetches.
      setDiffRefreshKey((n) => n + 1);
    } catch (err) {
      if (err instanceof FileApiError && err.code === "stale_mtime") {
        const body = (err.body ?? {}) as {
          currentContent?: string | null;
          currentMtimeMs?: number | null;
        };
        setConflict({
          currentContent: typeof body.currentContent === "string" ? body.currentContent : null,
          currentMtimeMs: typeof body.currentMtimeMs === "number" ? body.currentMtimeMs : null,
        });
      } else {
        setError(mapError(err));
      }
    } finally {
      setSaving(false);
    }
  }, [editable, dirty, saving, file.path, content, mtimeMs]);

  const handleReloadConflict = useCallback(() => {
    if (!conflict) return;
    const next = conflict.currentContent ?? "";
    setOriginal(next);
    setContent(next);
    setMtimeMs(conflict.currentMtimeMs);
    setConflict(null);
    setError(null);
  }, [conflict]);

  const handleOverwriteConflict = useCallback(async () => {
    if (!conflict || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await writeFile(
        file.path,
        content,
        // Pass the freshly-observed mtime so the second write succeeds
        // even with the optimistic-concurrency check still enabled.
        // currentMtimeMs is null only when the file was deleted under
        // us — in that case skip the check to recreate the file.
        conflict.currentMtimeMs !== null ? { expectedMtimeMs: conflict.currentMtimeMs } : {},
      );
      setOriginal(content);
      setMtimeMs(res.mtimeMs);
      setConflict(null);
      setDiffRefreshKey((n) => n + 1);
    } catch (err) {
      if (err instanceof FileApiError && err.code === "stale_mtime") {
        const body = (err.body ?? {}) as {
          currentContent?: string | null;
          currentMtimeMs?: number | null;
        };
        setConflict({
          currentContent: typeof body.currentContent === "string" ? body.currentContent : null,
          currentMtimeMs: typeof body.currentMtimeMs === "number" ? body.currentMtimeMs : null,
        });
      } else {
        setError(mapError(err));
      }
    } finally {
      setSaving(false);
    }
  }, [conflict, saving, file.path, content]);

  // Scroll-position preservation: when the user toggles between view and
  // edit, restore the scrollTop of the inner container so they don't lose
  // their place in a long file.
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const savedScrollByMode = useRef<Record<Mode, number>>({ view: 0, diff: 0, edit: 0 });
  const lastModeRef = useRef<Mode>(effectiveMode);
  useEffect(() => {
    const prev = lastModeRef.current;
    const next = effectiveMode;
    if (prev !== next) {
      // Save outgoing mode's scroll, restore incoming's on next paint.
      const el = contentScrollRef.current;
      if (el) savedScrollByMode.current[prev] = el.scrollTop;
      requestAnimationFrame(() => {
        const target = contentScrollRef.current;
        if (target) target.scrollTop = savedScrollByMode.current[next] ?? 0;
      });
      lastModeRef.current = next;
    }
  }, [effectiveMode]);

  const handleChangeMode = useCallback(
    (next: Mode) => {
      if (!editable) return;
      setMode(next);
      lastModeByPath.set(file.path, { mode: next, against });
    },
    [editable, file.path, against],
  );

  const handleChangeAgainst = useCallback(
    (next: DiffAgainst) => {
      setAgainst(next);
      const memo = lastModeByPath.get(file.path);
      lastModeByPath.set(file.path, { mode: memo?.mode ?? mode, against: next });
    },
    [file.path, mode],
  );

  const [copyAllOk, setCopyAllOk] = useState(false);
  const handleCopyAll = useCallback(async () => {
    if (!editable) return;
    try {
      await navigator.clipboard?.writeText(content);
      setCopyAllOk(true);
      setTimeout(() => setCopyAllOk(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }, [content, editable]);

  // Body-scroll lock while a panel is open on mobile so the page underneath
  // doesn't drift while the user scrolls the preview.
  useEffect(() => {
    if (!isMobile) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isMobile]);

  // Swipe-down-to-close on the mobile header. Tracks Y delta from the
  // touchstart Y; release with > 80 px downward delta closes the panel.
  const swipeStartY = useRef<number | null>(null);
  const onHeaderTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!isMobile) return;
      const t = e.touches[0];
      if (!t) return;
      swipeStartY.current = t.clientY;
    },
    [isMobile],
  );
  const onHeaderTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!isMobile) return;
      const start = swipeStartY.current;
      swipeStartY.current = null;
      if (start === null) return;
      const t = e.changedTouches[0];
      if (!t) return;
      if (t.clientY - start > 80) requestClose();
    },
    [isMobile, requestClose],
  );

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
        path={realPath ?? file.path}
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
        showModeToggle={editable}
        mode={effectiveMode}
        onChangeMode={editable ? handleChangeMode : undefined}
        diffAvailable={diffAvailable}
        against={against}
        onChangeAgainst={handleChangeAgainst}
        showWrapToggle={effectiveMode === "view" && (kind === "code" || kind === "text")}
        wrap={wrap}
        onToggleWrap={() => setWrap((w) => !w)}
        showCopyAll={editable}
        copyAllOk={copyAllOk}
        onCopyAll={editable ? handleCopyAll : undefined}
        showDownload
        onDownload={handleDownload}
        downloadInFlight={dl.progress !== null}
        onTouchStart={onHeaderTouchStart}
        onTouchEnd={onHeaderTouchEnd}
      />

      {conflict && editable && (
        <ConflictBanner
          dirty={dirty}
          busy={saving}
          onReload={handleReloadConflict}
          onOverwrite={handleOverwriteConflict}
        />
      )}

      <div ref={contentScrollRef} className="min-h-0 flex-1 overflow-y-auto">
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
                  .then((res) => {
                    setOriginal(res.content);
                    setContent(res.content);
                    setMtimeMs(res.mtimeMs);
                    setRealPath(res.path);
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
        {!loading && !error && isMediaOrBinary && kind === "binary" && (
          <BinaryPlaceholder file={file} onDownload={handleDownload} />
        )}
        {!loading && !error && isMediaOrBinary && kind !== "binary" && (
          <ReadablePreview file={file} kind={kind} content="" wrap={wrap} />
        )}
        {!loading && !error && editable && effectiveMode === "view" && (
          <ReadablePreview
            file={file}
            kind={kind}
            language={choice.language}
            content={content}
            wrap={wrap}
          />
        )}
        {!loading && !error && editable && effectiveMode === "diff" && (
          <DiffView file={file} against={against} refreshKey={diffRefreshKey} />
        )}
        {!loading && !error && editable && effectiveMode === "edit" && (
          <CodeMirror value={content} onChange={setContent} path={file.path} onSave={handleSave} />
        )}
      </div>

      <DownloadProgress progress={dl.progress} onCancel={dl.abort} />

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
