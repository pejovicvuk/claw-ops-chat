"use client";

import { useCallback, useMemo, useState } from "react";
import { FiRefreshCw, FiSearch, FiSettings, FiX } from "react-icons/fi";
import { SessionList } from "@/components/chat/session-list";
import { SidebarNav, type NavSection } from "./sidebar-nav";
import { useUrlState } from "@/lib/use-url-state";
import { useReportRuns } from "@/lib/use-reports";
import type { ChatSession } from "@/lib/types";

interface SidebarProps {
  // Chat props — forwarded to SessionList
  sessions: ChatSession[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  onRefreshSessions: () => void;
  sessionsLoading: boolean;
  runningSessionIds?: Set<string>;
  /** Forwarded to SessionList — enables the Delete context-menu item. */
  onDeleteSession?: (sessionId: string) => Promise<void>;
  /** Optional hook fired after a top-level nav change (Projects /
   *  Reports / Agents / Documents / New). The mobile drawer uses this
   *  to auto-close when the user picks a section so the new pane is
   *  visible without an extra tap. */
  onAfterNavigate?: () => void;
}

/**
 * Sidebar shell: Perplexity-style icon-row navigation at the top
 * (New / Projects / Reports / Agents / Documents) with a search field
 * and the recent chat history list always visible below.
 *
 * The list area no longer toggles per nav section the way it used to
 * with the segmented Chats / Reports / Projects tabs. Recent chats are
 * always present; the dashboards in the main pane provide the
 * project / report listings instead.
 */
export function Sidebar({
  sessions,
  selectedSessionId,
  onSelectSession,
  onNewChat,
  onRefreshSessions,
  sessionsLoading,
  runningSessionIds,
  onDeleteSession,
  onAfterNavigate,
}: SidebarProps) {
  const { params, setParam } = useUrlState();
  const view = params.get("view");
  const active: NavSection =
    view === "projects"
      ? "projects"
      : view === "reports"
        ? "reports"
        : view === "agents"
          ? "agents"
          : view === "documents"
            ? "documents"
            : "chats";

  const openSettings = useCallback(() => setParam("settings", "main"), [setParam]);

  // Local-only chat search filter — case-insensitive substring match
  // against `session.display`. Lives in component state (not URL) on
  // purpose: it's transient input that shouldn't round-trip through
  // history or be shareable.
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const filteredSessions = useMemo(() => {
    const q = chatSearchQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.display.toLowerCase().includes(q));
  }, [sessions, chatSearchQuery]);
  const noChatMatches =
    !!chatSearchQuery.trim() && sessions.length > 0 && filteredSessions.length === 0;

  // Reports unread badge — keep the existing fast-poll gate so the
  // count stays roughly live without a WebSocket. We only need
  // `unreadCount` here, no list rendering.
  const fastPoll = active === "reports" || view === "reports";
  const { feed } = useReportRuns({ fast: fastPoll });

  const handleNew = useCallback(() => {
    // Match the old "+ New chat" behaviour: clear any view scoping
    // params so the chat surface always wins, then start a fresh chat.
    setParam("view", null);
    setParam("project", null);
    setParam("report", null);
    setParam("newProject", null);
    setParam("newReport", null);
    setParam("sidebar", null);
    onNewChat();
    onAfterNavigate?.();
  }, [setParam, onNewChat, onAfterNavigate]);

  const handleNavigate = useCallback(
    (section: Exclude<NavSection, "chats">) => {
      // Centralised section routing. Each branch clears params owned
      // by *other* sections so deep-link state can't bleed across
      // (a stale `?report=` shouldn't survive into Projects view).
      setParam("view", section);
      setParam("sidebar", section);
      if (section === "projects") {
        setParam("report", null);
        setParam("newReport", null);
      } else if (section === "reports") {
        setParam("project", null);
        setParam("newProject", null);
      } else {
        setParam("project", null);
        setParam("report", null);
        setParam("newProject", null);
        setParam("newReport", null);
      }
      onAfterNavigate?.();
    },
    [setParam, onAfterNavigate],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SidebarNav
        active={active}
        onNew={handleNew}
        onNavigate={handleNavigate}
        unreadReports={feed.unreadCount}
      />

      {/* Divider between the nav block and the history block. Same hairline
          as the rest of the app's section separators. */}
      <div className="mx-3 mb-1 mt-1 border-t border-canvas-border" aria-hidden="true" />

      {/* History header — small caption + refresh button, mirroring the
          rhythm of the old "Chats" tab header but without the explicit
          tab strip. */}
      <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-canvas-muted">
          History
        </span>
        <button
          type="button"
          onClick={onRefreshSessions}
          className="btn-press flex h-6 w-6 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          aria-label="Refresh chats"
        >
          <FiRefreshCw size={11} />
        </button>
      </div>

      {/* Search bar — only shown when there's something to filter.
          Stays outside the scroll container so it doesn't drift while
          the list scrolls. `type="search"` gives the browser its native
          clear-X / Esc-clear affordance; we add an explicit clear
          button + onKeyDown for cross-browser consistency. */}
      {sessions.length > 0 && (
        <div className="shrink-0 px-3 pb-2">
          <div className="relative">
            <FiSearch
              size={11}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-canvas-muted"
            />
            <input
              type="search"
              value={chatSearchQuery}
              onChange={(e) => setChatSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setChatSearchQuery("");
              }}
              placeholder="Search chats..."
              aria-label="Search conversations"
              className="w-full rounded-full border border-canvas-border bg-canvas-surface-hover/40 py-1.5 pl-8 pr-8 text-[12px] text-canvas-fg placeholder:text-canvas-muted focus:border-accent/40 focus:bg-canvas-surface-hover focus:outline-none [&::-webkit-search-cancel-button]:appearance-none"
            />
            {chatSearchQuery && (
              <button
                type="button"
                onClick={() => setChatSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
              >
                <FiX size={10} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {noChatMatches ? (
          <div className="px-2 py-8 text-center">
            <p className="text-[11px] text-canvas-muted">
              No chats match &ldquo;{chatSearchQuery}&rdquo;
            </p>
            <button
              type="button"
              onClick={() => setChatSearchQuery("")}
              className="mt-2 rounded-md px-2 py-1 text-[11px] text-accent hover:bg-canvas-surface-hover"
            >
              Clear search
            </button>
          </div>
        ) : (
          <SessionList
            selectedSessionId={selectedSessionId}
            sessions={filteredSessions}
            loading={sessionsLoading}
            onSelectSession={onSelectSession}
            onNewChat={onNewChat}
            onRefresh={onRefreshSessions}
            runningSessionIds={runningSessionIds}
            onDeleteSession={onDeleteSession}
            hideHeader
            hideFooter
          />
        )}
      </div>

      <div className="shrink-0 border-t border-canvas-border px-2 py-2">
        <button
          type="button"
          onClick={openSettings}
          className="row-hover focus-ring flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
        >
          <FiSettings size={14} />
          Settings
        </button>
      </div>
    </div>
  );
}
