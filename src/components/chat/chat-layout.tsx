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
import { MobileFileSheet } from "./mobile-file-sheet";
import { FileBrowser, type FileBrowserHandle } from "./file-browser";
import { ErrorBoundary } from "@/components/error-boundary";
import { Sidebar } from "@/components/sidebar/sidebar";
import { ReportsMainPane } from "@/components/reports/reports-main-pane";
import { ProjectsMainPane } from "@/components/projects/projects-main-pane";
import { AgentsMainPane } from "@/components/agents/agents-main-pane";
import { ChatsMainPane } from "@/components/chats/chats-main-pane";

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
  /** Session IDs with a live WebSocket (shown as "active" dots in the sidebar). */
  runningSessionIds?: Set<string>;
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
  runningSessionIds,
  onDeleteSession,
}: ChatLayoutProps) {
  const isMobile = useIsMobile();
  useVisualViewport();
  const { params, setParam, setParamMulti } = useUrlState();
  const { toast } = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Mirrors `sidebarOpen` for the exit animation: when the drawer is
  // dismissed we flip `sidebarClosing` true, swap the slide-out class
  // in, and only flip `sidebarOpen` false (unmounting the drawer) once
  // the keyframe duration elapses. Without this the drawer would just
  // vanish on dismiss — the `animate-sidebar-out` class would never
  // get a chance to play. Duration must stay in sync with the CSS
  // `.animate-sidebar-out` animation length in globals.css.
  const [sidebarClosing, setSidebarClosing] = useState(false);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SIDEBAR_OUT_MS = 260;

  const openSidebar = useCallback(() => {
    // Cancel any in-flight close so a quick close→open ping doesn't
    // unmount the drawer mid-reopen.
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setSidebarClosing(false);
    setSidebarOpen(true);
  }, []);

  const closeSidebar = useCallback(() => {
    setSidebarOpen((open) => {
      if (!open) return open;
      setSidebarClosing(true);
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = setTimeout(() => {
        setSidebarOpen(false);
        setSidebarClosing(false);
        closeTimeoutRef.current = null;
      }, SIDEBAR_OUT_MS);
      return open; // stays mounted; the timeout flips it false
    });
  }, []);

  useEffect(
    () => () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    },
    [],
  );

  // On mobile, opening Settings (?settings=…) should auto-close the
  // sessions drawer — otherwise the two full-screen overlays stack and
  // the back-arrow flow gets confusing.
  const settingsParam = params.get("settings");
  useEffect(() => {
    if (!isMobile || !settingsParam) return;
    closeSidebar();
  }, [isMobile, settingsParam, closeSidebar]);
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
  // URL-driven file browser scope:
  //   ?root=<absolute-path>   — locks the browser to a folder (item canvas)
  //   ?path=<folder-path>     — current directory (default "~", or root when locked)
  const browserRoot = params.get("root") || null;
  const currentBrowserPath = params.get("path") || browserRoot || "~";
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

  /* ── Swipe-right to open sidebar (mobile) ──
   *
   * Handlers attach to a dedicated invisible edge strip (rendered in
   * the mobile JSX below) rather than the outer wrapper. The strip is
   * `touch-action: none`, which tells the browser up-front not to
   * scroll for touches that begin there — so a diagonal swipe doesn't
   * race us and let the chat commit to vertical scroll before we read
   * intent. Strip width (`SWIPE_EDGE_PX`) is the authoritative edge
   * zone; the old `clientX < 30` JS check is redundant once the
   * handlers can only fire from the strip itself. */
  const SWIPE_EDGE_PX = 32;
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const swipeOverlayRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
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

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartRef.current) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchStartRef.current.x;
      const dy = Math.abs(touch.clientY - touchStartRef.current.y);
      const elapsed = Date.now() - touchStartRef.current.time;

      // Swipe detected: mostly horizontal, >60px distance or fast flick
      if (dx > 60 && dx > dy * 1.5 && elapsed < 500) {
        openSidebar();
      }

      touchStartRef.current = null;
      if (swipeOverlayRef.current) {
        swipeOverlayRef.current.style.display = "none";
        swipeOverlayRef.current.style.opacity = "0";
      }
    },
    [openSidebar],
  );

  /* ── Swipe-left on the open drawer to close it ──
   *
   * Mirror of the edge-swipe-to-open gesture above, scoped to the
   * drawer element itself so it doesn't fight with vertical scrolling
   * elsewhere. Start anywhere on the drawer; if the finger ends > 60 px
   * to the left of its start within 500 ms AND the motion was mostly
   * horizontal (dx outweighs dy by 1.5×), dismiss. The horizontal
   * dominance check is what lets the session list still scroll
   * vertically — a vertical drag has dy >> |dx|, so it never qualifies
   * as a close gesture. */
  const drawerTouchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const handleDrawerTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    drawerTouchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }, []);

  const handleDrawerTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!drawerTouchStartRef.current) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - drawerTouchStartRef.current.x;
      const adx = Math.abs(dx);
      const dy = Math.abs(touch.clientY - drawerTouchStartRef.current.y);
      const elapsed = Date.now() - drawerTouchStartRef.current.time;

      if (dx < -60 && adx > dy * 1.5 && elapsed < 500) {
        closeSidebar();
      }

      drawerTouchStartRef.current = null;
    },
    [closeSidebar],
  );

  /* ── MOBILE ── */

  if (isMobile) {
    return (
      // `h-screen` (= 100vh), not `h-dvh`. In iOS PWA standalone mode
      // 100dvh is uninitialized on cold start until the viewport
      // "exercises" via a rotation — the page floor lands above the
      // home indicator until you rotate, producing the visible dark
      // gap users report as "won't reach the bottom." 100vh is the
      // only unit that's correct from first paint in standalone PWA.
      <div className="flex flex-col h-screen overflow-hidden">
        {/* Left-edge swipe catcher.
         *
         * Invisible vertical strip pinned to the left edge whose only
         * job is to claim horizontal swipes for the sidebar gesture.
         * `touch-action: none` tells the browser NOT to scroll for
         * touches starting here — that's what fixes the "I tried to
         * swipe open but the chat scrolled instead" bug. Without it,
         * any vertical component in the swipe lets the browser commit
         * to vertical scroll before our handlers can read intent. The
         * strip is only mounted while the drawer is closed; once it's
         * open, the drawer's own swipe-left handler takes over and
         * this strip would be redundant. */}
        {!sidebarOpen && !sidebarClosing && (
          <div
            aria-hidden="true"
            className="fixed inset-y-0 left-0"
            style={{
              width: SWIPE_EDGE_PX,
              zIndex: 15,
              touchAction: "none",
            }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          />
        )}
        {/* Swipe hint overlay */}
        <div
          ref={swipeOverlayRef}
          className="fixed inset-0 bg-black/30 hidden"
          style={{ zIndex: Z_INDEX.MODAL - 1, opacity: 0, transition: "opacity 100ms" }}
        />

        {/* Mobile renders ChatView edge-to-edge: NO top safe-area
            reservation. Content scrolls under the iOS status bar and
            under the floating chrome bubbles; the `.scroll-fade-top`
            overlay handles legibility by frosting that band. */}
        <div className="flex min-h-0 flex-1 flex-col">
          {params.get("view") === "projects" ? (
            <ProjectsMainPane onOpenSessions={openSidebar} />
          ) : params.get("view") === "reports" ? (
            <ReportsMainPane onOpenSessions={openSidebar} />
          ) : params.get("view") === "agents" ? (
            <AgentsMainPane onOpenSessions={openSidebar} />
          ) : params.get("view") === "chats" ? (
            <ChatsMainPane
              sessions={sessions}
              selectedSessionId={selectedSessionId}
              sessionsLoading={sessionsLoading}
              onSelectSession={onSelectSession}
              onNewChat={onNewChat}
              onRefreshSessions={onRefreshSessions}
              runningSessionIds={runningSessionIds}
              onDeleteSession={onDeleteSession}
              onOpenSessions={openSidebar}
            />
          ) : (
            <ChatView
              sessionId={sessionId}
              resumeSessionId={selectedSessionId}
              onSessionCreated={onSessionCreated}
              onOpenSessions={openSidebar}
              onOpenFiles={() => setFilesPanelOpen(true)}
              onNewChat={onNewChat}
              headerless
            />
          )}
        </div>

        {(sidebarOpen || sidebarClosing) && (
          <>
            <div
              className={`fixed inset-0 bg-black/30 backdrop-blur-[3px] ${
                sidebarClosing ? "animate-backdrop-out" : "animate-backdrop-in"
              }`}
              style={{ zIndex: Z_INDEX.MODAL }}
              onClick={closeSidebar}
            />
            <div
              className={`fixed inset-y-0 left-0 w-[300px] bg-canvas-bg shadow-2xl ${
                sidebarClosing ? "animate-sidebar-out" : "animate-sidebar-in"
              }`}
              style={{
                zIndex: Z_INDEX.MODAL + 1,
                borderRight: "1px solid var(--canvas-border)",
              }}
              onTouchStart={handleDrawerTouchStart}
              onTouchEnd={handleDrawerTouchEnd}
            >
              <div
                className="flex h-full flex-col"
                style={{
                  paddingTop: "max(env(safe-area-inset-top, 0px), 8px)",
                  // The drawer is `position: fixed inset-y-0`, so it
                  // extends edge-to-edge and would otherwise let its last
                  // session row sit underneath the iOS home indicator.
                  paddingBottom: "env(safe-area-inset-bottom, 0px)",
                }}
              >
                {/* Header intentionally removed on mobile — the drawer
                    closes by tapping the backdrop, swiping left, or
                    selecting a session. An inline X wastes vertical
                    space that's better spent on the session list. */}
                <Sidebar
                  selectedSessionId={selectedSessionId}
                  sessions={sessions}
                  sessionsLoading={sessionsLoading}
                  onSelectSession={(sid) => {
                    onSelectSession(sid);
                    closeSidebar();
                  }}
                  onNewChat={() => {
                    onNewChat();
                    closeSidebar();
                  }}
                  onRefreshSessions={onRefreshSessions}
                  runningSessionIds={runningSessionIds}
                  onDeleteSession={onDeleteSession}
                  onAfterNavigate={closeSidebar}
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
          selectedSessionId={selectedSessionId}
          rootPath={browserRoot}
        />

        {fileEditors}
      </div>
    );
  }

  /* ── DESKTOP ── */

  // ~1/5 of the viewport (20vw), clamped so the sidebar never collapses
  // its content on smaller laptops or balloons on ultrawides:
  //   ≤ 1500 px viewport → pinned at 300 px floor
  //   1500 – 2100 px      → grows linearly with the screen (≈ 1/5)
  //   ≥ 2100 px           → capped at 420 px
  // Shared between the grid track and the inner div via this constant
  // so they stay in sync when the value is tuned.
  const SIDEBAR_EXPANDED_WIDTH = "clamp(300px, 20vw, 420px)";
  const desktopGridCols = `${
    sidebarCollapsed ? "40px" : SIDEBAR_EXPANDED_WIDTH
  } minmax(0,1fr) ${filesPanelOpen ? 300 : 40}px`;

  return (
    <>
      <div
        className="grid h-full transition-[grid-template-columns] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{ gridTemplateColumns: desktopGridCols, gridTemplateRows: "minmax(0, 1fr)" }}
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
            <div className="flex h-full flex-col" style={{ width: SIDEBAR_EXPANDED_WIDTH }}>
              <div className="flex h-12 shrink-0 items-center justify-between px-3">
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
              <Sidebar
                selectedSessionId={selectedSessionId}
                sessions={sessions}
                sessionsLoading={sessionsLoading}
                onSelectSession={onSelectSession}
                onNewChat={onNewChat}
                onRefreshSessions={onRefreshSessions}
                runningSessionIds={runningSessionIds}
                onDeleteSession={onDeleteSession}
              />
            </div>
          )}
        </aside>

        {/* Center: Chat or Reports dashboard.
            `min-h-0 overflow-hidden` is what lets the reports tree scroll:
            grid/flex items default to `min-height: auto`, which was letting
            long markdown reports and long live-run logs push the cell past
            the grid's height and off the bottom of the viewport. The grid
            itself also got `grid-template-rows: minmax(0, 1fr)` so the single
            row can't grow past the container. ChatView masks the same bug
            with its own inline `height:100%;overflow:hidden` but the reports
            tree relied on the parent being bounded. */}
        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          {params.get("view") === "projects" ? (
            <ProjectsMainPane />
          ) : params.get("view") === "reports" ? (
            <ReportsMainPane />
          ) : params.get("view") === "agents" ? (
            <AgentsMainPane />
          ) : params.get("view") === "chats" ? (
            <ChatsMainPane
              sessions={sessions}
              selectedSessionId={selectedSessionId}
              sessionsLoading={sessionsLoading}
              onSelectSession={onSelectSession}
              onNewChat={onNewChat}
              onRefreshSessions={onRefreshSessions}
              runningSessionIds={runningSessionIds}
              onDeleteSession={onDeleteSession}
            />
          ) : (
            <ChatView
              sessionId={sessionId}
              resumeSessionId={selectedSessionId}
              onSessionCreated={onSessionCreated}
              headerless
            />
          )}
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
                    selectedSessionId={selectedSessionId}
                    rootPath={browserRoot}
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
