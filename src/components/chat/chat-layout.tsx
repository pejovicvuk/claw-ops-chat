"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FiMessageCircle,
  FiX,
  FiFolder,
  FiCheck,
  FiChevronsLeft,
  FiMessageSquare,
  FiUpload,
} from "react-icons/fi";
import { useIsMobile } from "@/lib/use-is-mobile";
import { useVisualViewport } from "@/lib/use-visual-viewport";
import { Z_INDEX } from "@/lib/z-index";
import { uploadFile } from "@/lib/api";
import type { ChatSession, FileEntry } from "@/lib/types";
import { ChatView } from "./chat-view";
import { SessionList } from "./session-list";
import { MobileFileSheet } from "./mobile-file-sheet";
import { FileBrowser, type FileBrowserHandle } from "./file-browser";
import { FileEditorPanel } from "./file-editor-panel";

interface ChatLayoutProps {
  sessions: ChatSession[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  onRefreshSessions: () => void;
  sessionsLoading: boolean;
  runningSessionIds?: Set<string>;
  onSessionCreated?: (claudeSessionId: string) => void;
}

export function ChatLayout({
  sessions,
  selectedSessionId,
  onSelectSession,
  onNewChat,
  onRefreshSessions,
  sessionsLoading,
  runningSessionIds,
  onSessionCreated,
}: ChatLayoutProps) {
  const isMobile = useIsMobile();
  useVisualViewport();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [filesPanelOpen, setFilesPanelOpen] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const [openFiles, setOpenFiles] = useState<{ key: string; file: FileEntry }[]>([]);
  const [focusOrder, setFocusOrder] = useState<string[]>([]);

  const fileBrowserRef = useRef<FileBrowserHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentBrowserPath] = useState("~");

  // Stable session ID — only changes when user explicitly picks a session or clicks New Chat.
  const [sessionId, setSessionId] = useState(() => selectedSessionId || "new-" + Date.now());

  // Update when user picks a different session or clicks New Chat
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- legitimate prop→state sync
    setSessionId(selectedSessionId || "new-" + Date.now());
  }, [selectedSessionId]);

  const handleCopyPath = useCallback((path: string) => {
    const atPath = `@${path}`;
    navigator.clipboard
      .writeText(atPath)
      .then(() => {
        setCopiedPath(path);
        setTimeout(() => setCopiedPath(null), 1500);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (
            node instanceof HTMLElement &&
            node.style.left &&
            node.style.top &&
            getComputedStyle(node).position === "fixed"
          ) {
            requestAnimationFrame(() => {
              const rect = node.getBoundingClientRect();
              const maxLeft = window.innerWidth - rect.width - 8;
              if (rect.left > maxLeft) node.style.left = `${Math.max(8, maxLeft)}px`;
              const maxTop = window.innerHeight - rect.height - 8;
              if (rect.top > maxTop) node.style.top = `${Math.max(8, maxTop)}px`;
            });
          }
        }
      }
    });
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, []);

  const handleFileOpen = useCallback((file: FileEntry) => {
    const key = `file:${file.path}`;
    setOpenFiles((prev) => (prev.some((e) => e.key === key) ? prev : [...prev, { key, file }]));
    setFocusOrder((prev) => [...prev.filter((k) => k !== key), key]);
  }, []);

  const handleFileClose = useCallback((key: string) => {
    setOpenFiles((prev) => prev.filter((e) => e.key !== key));
    setFocusOrder((prev) => prev.filter((k) => k !== key));
  }, []);

  const handleFileFocus = useCallback((key: string) => {
    setFocusOrder((prev) => [...prev.filter((k) => k !== key), key]);
  }, []);

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

  const fileEditors = openFiles.map((entry) => (
    <FileEditorPanel
      key={entry.key}
      file={entry.file}
      zIndex={Z_INDEX.MODAL + focusOrder.indexOf(entry.key)}
      onFocus={() => handleFileFocus(entry.key)}
      onClose={() => handleFileClose(entry.key)}
    />
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

        {/* Floating chat button — sits beside mode bar */}
        <div
          className="fixed left-3 z-30 flex items-center"
          style={{ top: "max(env(safe-area-inset-top, 0px), 6px)" }}
        >
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="glass flex h-9 w-9 items-center justify-center rounded-full shadow-md transition-transform duration-200 active:scale-90"
          >
            <FiMessageCircle size={16} className="text-canvas-fg" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <ChatView
            key={sessionId}
            sessionId={sessionId}
            resumeSessionId={selectedSessionId}
            onSessionCreated={onSessionCreated}
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
              <div className="flex h-full flex-col">
                <div
                  className="flex items-center justify-between px-4 py-3"
                  style={{
                    paddingTop: "max(env(safe-area-inset-top, 0px), 16px)",
                    borderBottom: "1px solid var(--canvas-border)",
                  }}
                >
                  <span className="text-[15px] font-semibold text-canvas-fg">Conversations</span>
                  <button
                    type="button"
                    onClick={() => setSidebarOpen(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-canvas-muted hover:bg-canvas-surface-hover transition-colors duration-150"
                  >
                    <FiX size={16} />
                  </button>
                </div>
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
                  runningSessionIds={runningSessionIds}
                />
              </div>
            </div>
          </>
        )}

        <MobileFileSheet
          open={filesPanelOpen}
          onClose={() => setFilesPanelOpen(false)}
          onCopyPath={handleCopyPath}
          onFileOpen={handleFileOpen}
        />

        {fileEditors}

        {copiedPath && (
          <div
            className="fixed left-1/2 top-20 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-green-600 px-3 py-1.5 shadow-lg"
            style={{ zIndex: Z_INDEX.TOAST }}
          >
            <FiCheck size={12} className="text-white" />
            <span className="text-[11px] font-medium text-white">Path copied</span>
          </div>
        )}
      </div>
    );
  }

  /* ── DESKTOP ── */

  return (
    <>
      <div className="flex h-full">
        {/* Left sidebar */}
        <aside
          className={`flex shrink-0 flex-col border-r border-canvas-border bg-canvas-bg overflow-hidden transition-all duration-200 ${
            sidebarCollapsed ? "w-10" : "w-[260px]"
          }`}
        >
          {sidebarCollapsed ? (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              className="flex h-full w-10 items-center justify-center text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
              title="Show chats"
            >
              <FiMessageSquare size={16} />
            </button>
          ) : (
            <>
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-canvas-border px-3">
                <span className="text-[13px] font-semibold text-canvas-fg">Claw Chat</span>
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(true)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
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
              />
            </>
          )}
        </aside>

        {/* Center: Chat */}
        <main className="flex min-w-0 flex-1 flex-col">
          <ChatView
            key={sessionId}
            sessionId={sessionId}
            resumeSessionId={selectedSessionId}
            onSessionCreated={onSessionCreated}
            headerless
          />
        </main>

        {/* Right: File panel */}
        <aside
          className={`flex shrink-0 flex-col border-l border-canvas-border bg-canvas-bg overflow-hidden transition-all duration-200 ${
            filesPanelOpen ? "w-[300px] h-full" : "w-10"
          }`}
        >
          {filesPanelOpen ? (
            <>
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
                    className="flex h-7 w-7 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
                    title="Upload files"
                  >
                    <FiUpload size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilesPanelOpen(false)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
                  >
                    <FiX size={14} />
                  </button>
                </div>
              </div>

              {copiedPath && (
                <div className="flex items-center gap-1.5 border-b border-canvas-border bg-green-500/10 px-3 py-1.5">
                  <FiCheck size={11} className="text-green-400" />
                  <span className="truncate text-[10px] text-green-400">Copied: {copiedPath}</span>
                </div>
              )}

              <div className="file-panel-fill min-h-0 flex-1">
                <FileBrowser
                  ref={fileBrowserRef}
                  onFileClick={handleCopyPath}
                  onFileOpen={handleFileOpen}
                  hideRunOption
                  onCopyPath={(path) => {
                    navigator.clipboard
                      .writeText(`@${path}`)
                      .then(() => {
                        setCopiedPath(path);
                        setTimeout(() => setCopiedPath(null), 1500);
                      })
                      .catch(() => {});
                  }}
                />
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setFilesPanelOpen(true)}
              className="flex h-full w-10 items-center justify-center text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
              title="Show files"
            >
              <FiFolder size={16} />
            </button>
          )}
        </aside>
      </div>

      {fileEditors}

      {copiedPath && (
        <div
          className="fixed left-1/2 top-20 -translate-x-1/2 flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 shadow-lg"
          style={{ zIndex: Z_INDEX.TOAST }}
        >
          <FiCheck size={12} className="text-white" />
          <span className="text-[11px] font-medium text-white">Path copied</span>
        </div>
      )}
    </>
  );
}
