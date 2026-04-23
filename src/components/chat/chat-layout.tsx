"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { FiX, FiFolder, FiChevronsLeft, FiMessageSquare, FiUpload } from "react-icons/fi";
import { useIsMobile } from "@/lib/use-is-mobile";
import { useVisualViewport } from "@/lib/use-visual-viewport";
import { useUrlState } from "@/lib/use-url-state";
import { useToast } from "@/lib/use-toast";
import { Z_INDEX } from "@/lib/z-index";
import { uploadFile } from "@/lib/api";
import type { ChatSession, FileEntry } from "@/lib/types";
import { ChatView } from "./chat-view";
import { SessionList } from "./session-list";
import { MobileFileSheet } from "./mobile-file-sheet";
import { FileBrowser, type FileBrowserHandle } from "./file-browser";
import { ErrorBoundary } from "@/components/error-boundary";

// Lazy: CodeMirror core (~180kb gz) is pulled into this chunk. Only loads
// when the user opens a file. ssr:false because the editor is pointer-driven.
const FileEditorPanel = dynamic(
  () => import("./file-editor-panel").then((m) => ({ default: m.FileEditorPanel })),
  { ssr: false, loading: () => null },
);

interface ChatLayoutProps {
  sessions: ChatSession[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  onRefreshSessions: () => void;
  sessionsLoading: boolean;
  onSessionCreated?: (claudeSessionId: string) => void;
  /**
   * Delete a session end-to-end. Passed through to both SessionList
   * instances (mobile drawer + desktop sidebar). Undefined → context
   * menu hides the Delete item.
   */
  onDeleteSession?: (sessionId: string) => Promise<void>;
}

export function ChatLayout({
  sessions,
  selectedSessionId,
  onSelectSession,
  onNewChat,
  onRefreshSessions,
  sessionsLoading,
  onSessionCreated,
  onDeleteSession,
}: ChatLayoutProps) {
  const isMobile = useIsMobile();
  useVisualViewport();
  const { params, setParam, setParamMulti } = useUrlState();
  const { toast } = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // On mobile, opening Settings (?settings=…) should auto-close the
  // sessions drawer — otherwise the two full-screen overlays stack and
  // the back-arrow flow gets confusing.
  const settingsParam = params.get("settings");
  useEffect(() => {
    if (!isMobile || !settingsParam) return;
    // Defer the state update so it doesn't synchronously cascade mid-
    // render — the lint rule `react-hooks/immutability` flags synchronous
    // setState inside an effect. A single microtask is imperceptible to
    // the user but lets React finish the current commit first.
    const t = setTimeout(() => setSidebarOpen(false), 0);
    return () => clearTimeout(t);
  }, [isMobile, settingsParam]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // URL-driven: ?files=1 = open, absent/0 = closed
  const filesPanelOpen = params.get("files") === "1";
  const setFilesPanelOpen = useCallback(
    (open: boolean) => setParam("files", open ? "1" : null),
    [setParam],
  );

  /**
   * Open editor panels are URL-backed so a refresh re-opens everything that
   * was on screen. `?open=<path>` repeats per panel in focus order (oldest
   * first); `?active=<path>` names the one on top. Per-panel geometry lives
   * in localStorage via `layout-store.ts` — combined, both position and set
   * survive a reload.
   */
  const openPaths = useMemo(() => params.getAll("open"), [params]);
  const activePath = params.get("active");

  const openFiles = useMemo<{ key: string; file: FileEntry }[]>(
    () =>
      openPaths.map((p) => ({
        key: `file:${p}`,
        file: {
          name: p.split("/").pop() || p,
          path: p,
          directory: false,
          size: 0,
          mtime: 0,
        },
      })),
    [openPaths],
  );

  const focusOrder = useMemo<string[]>(() => {
    const keys = openPaths.map((p) => `file:${p}`);
    if (!activePath) return keys;
    // Move the active path to the end (top of z-stack) without dropping the
    // rest of the order — mirrors how `handleFileFocus` used to splice.
    const activeKey = `file:${activePath}`;
    return [...keys.filter((k) => k !== activeKey), activeKey].filter((k) => keys.includes(k));
  }, [openPaths, activePath]);

  const fileBrowserRef = useRef<FileBrowserHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // URL-driven: ?path=<folder-path> (defaults to "~")
  const currentBrowserPath = params.get("path") || "~";
  const setCurrentBrowserPath = useCallback(
    (path: string) => setParam("path", path === "~" ? null : path),
    [setParam],
  );

  // Stable session ID — only changes when user explicitly picks a session or clicks New Chat.
  const [sessionId, setSessionId] = useState(() => selectedSessionId || "new-" + Date.now());

  // Update when user picks a different session or clicks New Chat
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- legitimate prop→state sync
    setSessionId(selectedSessionId || "new-" + Date.now());
  }, [selectedSessionId]);

  const handleCopyPath = useCallback(
    (path: string) => {
      const atPath = `@${path}`;
      navigator.clipboard
        .writeText(atPath)
        .then(() => toast.success("Path copied"))
        .catch(() => toast.error("Couldn't copy path"));
    },
    [toast],
  );

  // Viewport clamping for editor panels is now handled inside the panel
  // itself via `clampRectToViewport` — no global MutationObserver needed.

  const handleRevealInBrowser = useCallback(
    (path: string) => {
      // Sync URL first — the mobile sheet remounts its FileBrowser every
      // time it opens with `initialPath` bound to `currentBrowserPath`,
      // so this makes sure mobile starts at the right folder.
      setCurrentBrowserPath(path);
      setFilesPanelOpen(true);
      // Desktop panel stays mounted; poke its ref to navigate in place.
      requestAnimationFrame(() => {
        fileBrowserRef.current?.navigateTo(path);
      });
    },
    [setCurrentBrowserPath, setFilesPanelOpen],
  );

  const handleFileOpen = useCallback(
    (file: FileEntry) => {
      // Mirror into URL: append path if not present, mark active.
      const current = new URLSearchParams(window.location.search).getAll("open");
      const next = current.includes(file.path) ? current : [...current, file.path];
      setParamMulti("open", next);
      setParam("active", file.path);
    },
    [setParam, setParamMulti],
  );

  const handleFileClose = useCallback(
    (key: string) => {
      const path = key.startsWith("file:") ? key.slice("file:".length) : key;
      const current = new URLSearchParams(window.location.search).getAll("open");
      const next = current.filter((p) => p !== path);
      setParamMulti("open", next);
      const currentActive = new URLSearchParams(window.location.search).get("active");
      if (currentActive === path) {
        setParam("active", next.length ? next[next.length - 1] : null);
      }
    },
    [setParam, setParamMulti],
  );

  const handleFileFocus = useCallback(
    (key: string) => {
      const path = key.startsWith("file:") ? key.slice("file:".length) : key;
      setParam("active", path);
    },
    [setParam],
  );

  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      for (let i = 0; i < files.length; i++) {
        await uploadFile(currentBrowserPath, files[i]);
      }
      fileBrowserRef.current?.navigateTo(currentBrowserPath);
      e.target.value = "";
    },
    [currentBrowserPath],
  );

  const fileEditors = openFiles.map((entry, idx) => (
    <ErrorBoundary key={entry.key} label="the file editor">
      <FileEditorPanel
        file={entry.file}
        stackIndex={idx}
        zIndex={Z_INDEX.MODAL + focusOrder.indexOf(entry.key)}
        onFocus={() => handleFileFocus(entry.key)}
        onClose={() => handleFileClose(entry.key)}
        onRevealInBrowser={handleRevealInBrowser}
      />
    </ErrorBoundary>
  ));

  /* ── Swipe-right to open sidebar (mobile) ── */
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const swipeOverlayRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    // Only track swipes starting from left edge (first 30px)
    if (touch.clientX < 30) {
      touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    }
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartRef.current || sidebarOpen) return;
      const touch = e.touches[0];
      const dx = touch.clientX - touchStartRef.current.x;
      const dy = Math.abs(touch.clientY - touchStartRef.current.y);
      // If mostly horizontal and moved enough
      if (dx > 10 && dx > dy * 1.5 && swipeOverlayRef.current) {
        const progress = Math.min(dx / 280, 1);
        swipeOverlayRef.current.style.opacity = String(progress * 0.3);
        swipeOverlayRef.current.style.pointerEvents = "none";
        swipeOverlayRef.current.style.display = "block";
      }
    },
    [sidebarOpen],
  );

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = Math.abs(touch.clientY - touchStartRef.current.y);
    const elapsed = Date.now() - touchStartRef.current.time;

    // Swipe detected: mostly horizontal, >60px distance or fast flick
    if (dx > 60 && dx > dy * 1.5 && elapsed < 500) {
      setSidebarOpen(true);
    }

    touchStartRef.current = null;
    if (swipeOverlayRef.current) {
      swipeOverlayRef.current.style.display = "none";
      swipeOverlayRef.current.style.opacity = "0";
    }
  }, []);

  /* ── MOBILE ── */

  if (isMobile) {
    return (
      <div
        className="flex flex-col h-dvh overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Swipe hint overlay */}
        <div
          ref={swipeOverlayRef}
          className="fixed inset-0 bg-black/30 hidden"
          style={{ zIndex: Z_INDEX.MODAL - 1, opacity: 0, transition: "opacity 100ms" }}
        />

        {/* Mobile only renders ChatView — it owns the single top toolbar
            now (Mode/Effort pills + sessions button), so we don't stack
            a second bar above it. Reserve safe-area-top for the notch. */}
        <div
          className="flex min-h-0 flex-1 flex-col"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 0px)" }}
        >
          <ChatView
            sessionId={sessionId}
            resumeSessionId={selectedSessionId}
            onSessionCreated={onSessionCreated}
            onOpenSessions={() => setSidebarOpen(true)}
            headerless
            fileButton={
              <div className="flex items-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleUpload}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg transition-colors duration-150"
                >
                  <FiUpload size={17} />
                </button>
                <button
                  type="button"
                  onClick={() => setFilesPanelOpen(true)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg transition-colors duration-150"
                >
                  <FiFolder size={18} />
                </button>
              </div>
            }
          />
        </div>

        {sidebarOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/30 backdrop-blur-[3px]"
              style={{ zIndex: Z_INDEX.MODAL, transition: "opacity 300ms ease" }}
              onClick={() => setSidebarOpen(false)}
            />
            <div
              className="animate-sidebar-in fixed inset-y-0 left-0 w-[300px] bg-canvas-bg shadow-2xl"
              style={{
                zIndex: Z_INDEX.MODAL + 1,
                borderRight: "1px solid var(--canvas-border)",
              }}
            >
              <div
                className="flex h-full flex-col"
                style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 8px)" }}
              >
                {/* Header intentionally removed on mobile — the drawer
                    closes by tapping the backdrop, swiping left, or
                    selecting a session. An inline X wastes vertical
                    space that's better spent on the session list. */}
                <SessionList
                  selectedSessionId={selectedSessionId}
                  sessions={sessions}
                  loading={sessionsLoading}
                  onSelectSession={(sid) => {
                    onSelectSession(sid);
                    setSidebarOpen(false);
                  }}
                  onNewChat={() => {
                    onNewChat();
                    setSidebarOpen(false);
                  }}
                  onRefresh={onRefreshSessions}
                  onDeleteSession={onDeleteSession}
                />
              </div>
            </div>
          </>
        )}

        <MobileFileSheet
          open={filesPanelOpen}
          onClose={() => setFilesPanelOpen(false)}
          initialPath={currentBrowserPath}
          onPathChange={setCurrentBrowserPath}
          onCopyPath={handleCopyPath}
          onFileOpen={handleFileOpen}
        />

        {fileEditors}
      </div>
    );
  }

  /* ── DESKTOP ── */

  const desktopGridCols = `${sidebarCollapsed ? 40 : 260}px minmax(0,1fr) ${
    filesPanelOpen ? 300 : 40
  }px`;

  return (
    <>
      <div
        className="grid h-full transition-[grid-template-columns] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{ gridTemplateColumns: desktopGridCols }}
      >
        {/* Left sidebar — grid owns the width tween; aside clips its fixed-width inner */}
        <aside className="relative flex flex-col overflow-hidden border-r border-canvas-border bg-canvas-bg">
          {sidebarCollapsed ? (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              className="btn-press flex h-full w-10 items-center justify-center text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
              title="Show chats"
            >
              <FiMessageSquare size={16} />
            </button>
          ) : (
            <div className="flex h-full w-[260px] flex-col">
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-canvas-border px-3">
                <span className="text-[13px] font-semibold text-canvas-fg">Claw Chat</span>
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(true)}
                  className="btn-press flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
                  title="Collapse sidebar"
                >
                  <FiChevronsLeft size={14} />
                </button>
              </div>
              <SessionList
                selectedSessionId={selectedSessionId}
                sessions={sessions}
                loading={sessionsLoading}
                onSelectSession={onSelectSession}
                onNewChat={onNewChat}
                onRefresh={onRefreshSessions}
                onDeleteSession={onDeleteSession}
              />
            </div>
          )}
        </aside>

        {/* Center: Chat */}
        <main className="flex min-w-0 flex-col">
          <ChatView
            key={sessionId}
            sessionId={sessionId}
            resumeSessionId={selectedSessionId}
            onSessionCreated={onSessionCreated}
            headerless
          />
        </main>

        {/* Right: File panel — same pattern: grid drives width, aside clips fixed-width inner */}
        <aside className="relative flex flex-col overflow-hidden border-l border-canvas-border bg-canvas-bg">
          {filesPanelOpen ? (
            <div className="flex h-full w-[300px] flex-col">
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-canvas-border px-3">
                <span className="text-[12px] font-medium text-canvas-muted">Files</span>
                <div className="flex items-center gap-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleUpload}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="btn-press flex h-7 w-7 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
                    title="Upload files"
                  >
                    <FiUpload size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilesPanelOpen(false)}
                    className="btn-press flex h-7 w-7 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
                  >
                    <FiX size={14} />
                  </button>
                </div>
              </div>

              <div className="file-panel-fill min-h-0 flex-1">
                <ErrorBoundary label="the file browser">
                  <FileBrowser
                    ref={fileBrowserRef}
                    initialPath={currentBrowserPath}
                    onPathChange={setCurrentBrowserPath}
                    onFileClick={handleCopyPath}
                    onFileOpen={handleFileOpen}
                    hideRunOption
                    onCopyPath={handleCopyPath}
                  />
                </ErrorBoundary>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setFilesPanelOpen(true)}
              className="btn-press flex h-full w-10 items-center justify-center text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
              title="Show files"
            >
              <FiFolder size={16} />
            </button>
          )}
        </aside>
      </div>

      {fileEditors}
    </>
  );
}
