"use client";

import { useMemo, useState, type ReactNode } from "react";
import { FiMessageCircle, FiSearch, FiX } from "react-icons/fi";
import type { ChatSession } from "@/lib/types";
import { SessionList } from "@/components/chat/session-list";

interface ChatsMainPaneProps {
  sessions: ChatSession[];
  selectedSessionId: string | null;
  sessionsLoading: boolean;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  onRefreshSessions: () => void;
  runningSessionIds?: Set<string>;
  onDeleteSession?: (sessionId: string) => Promise<void>;
  /** Mobile-only: lets the page open the sessions drawer. */
  onOpenSessions?: () => void;
}

/**
 * Detailed Chats browser + search. Replaces the cramped sidebar search
 * with a full-pane experience: a prominent search input that filters
 * the entire history, plus a result count and an empty state, and the
 * existing SessionList rendering for row chrome / status dots / context
 * menu / delete confirm — so behaviour is identical to clicking from
 * the sidebar.
 */
export function ChatsMainPane({
  sessions,
  selectedSessionId,
  sessionsLoading,
  onSelectSession,
  onNewChat,
  onRefreshSessions,
  runningSessionIds,
  onDeleteSession,
  onOpenSessions,
}: ChatsMainPaneProps): ReactNode {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.display.toLowerCase().includes(q));
  }, [sessions, query]);

  const trimmed = query.trim();
  const noResults = trimmed.length > 0 && filtered.length === 0;

  return (
    <div className="flex h-full flex-col">
      {/* Mobile header — tiny back-to-sessions affordance because the
          mobile drawer auto-closes on nav and there's no other way to
          reach the chat surface from this page on a phone. */}
      {onOpenSessions && (
        <header className="flex h-12 shrink-0 items-center border-b border-canvas-border px-3 md:hidden">
          <button
            type="button"
            onClick={onOpenSessions}
            className="btn-press flex h-8 w-8 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
            aria-label="Open sessions"
          >
            <FiMessageCircle size={16} />
          </button>
          <span className="ml-2 text-[14px] font-semibold text-canvas-fg">Chats</span>
        </header>
      )}

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pt-8 md:px-6 md:pt-12">
        <h1 className="text-[28px] font-semibold tracking-tight text-canvas-fg md:text-[32px]">
          Chats
        </h1>
        <p className="mt-1 text-[14px] leading-relaxed text-canvas-muted">
          Browse, search, and jump to any of your conversations.
        </p>

        {/* Prominent search input — full width, glass surface, accent
            focus ring. Bigger and roomier than the old 12 px sidebar
            search so it reads as the page's primary affordance. */}
        <div className="relative mt-6">
          <FiSearch
            size={16}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-canvas-muted"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search by title…"
            aria-label="Search chats"
            autoFocus
            className="w-full rounded-full border border-canvas-border bg-canvas-surface-hover/40 py-3 pl-11 pr-11 text-[15px] text-canvas-fg placeholder:text-canvas-muted focus:border-accent/50 focus:bg-canvas-surface-hover focus:outline-none [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
            >
              <FiX size={13} />
            </button>
          )}
        </div>

        <div
          className="mt-4 flex items-center justify-between text-[12px] text-canvas-muted"
          aria-live="polite"
        >
          <span>
            {trimmed
              ? `${filtered.length} of ${sessions.length} ${sessions.length === 1 ? "chat" : "chats"}`
              : `${sessions.length} ${sessions.length === 1 ? "chat" : "chats"}`}
          </span>
        </div>

        <div className="mt-2 flex-1 overflow-y-auto pb-6">
          {noResults ? (
            <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
              <p className="text-[14px] text-canvas-muted">
                No chats match &ldquo;{trimmed}&rdquo;
              </p>
              <button
                type="button"
                onClick={() => setQuery("")}
                className="mt-3 rounded-md px-3 py-1 text-[13px] text-accent hover:bg-canvas-surface-hover"
              >
                Clear search
              </button>
            </div>
          ) : (
            <SessionList
              selectedSessionId={selectedSessionId}
              sessions={filtered}
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
      </div>
    </div>
  );
}
