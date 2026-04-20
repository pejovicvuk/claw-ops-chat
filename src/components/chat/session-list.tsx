"use client";

import { FiPlus, FiRefreshCw, FiSettings } from "react-icons/fi";
import type { ChatSession } from "@/lib/types";
import { useUrlState } from "@/lib/use-url-state";
import { useSessionStatuses } from "@/lib/use-session-statuses";
import type { SessionStatus } from "@/lib/session-status-store";

/**
 * Colour + label for the dot shown next to each session in the sidebar.
 * Orange is deliberately the only non-pulsing colour — a session that
 * needs permission should stand out even if the user's glance misses
 * the animation.
 */
const STATUS_UI: Record<
  Exclude<SessionStatus, "idle">,
  { dotClass: string; label: string }
> = {
  thinking: { dotClass: "bg-blue-400 animate-pulse", label: "Thinking" },
  tool_running: { dotClass: "bg-purple-400 animate-pulse", label: "Running tool" },
  awaiting_permission: { dotClass: "bg-orange-400", label: "Needs permission" },
  awaiting_input: { dotClass: "bg-amber-400 animate-pulse", label: "Needs input" },
};

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface SessionListProps {
  selectedSessionId?: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  sessions: ChatSession[];
  loading: boolean;
  onRefresh: () => void;
  runningSessionIds?: Set<string>;
}

export function SessionList({
  selectedSessionId,
  onSelectSession,
  onNewChat,
  sessions,
  loading,
  onRefresh,
  runningSessionIds,
}: SessionListProps) {
  const { setParam } = useUrlState();
  const openSettings = () => setParam("settings", "main");
  const statuses = useSessionStatuses();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-canvas-border px-3 py-2.5">
        <span className="text-[13px] font-semibold text-canvas-fg">Chats</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onRefresh}
            className="flex h-7 w-7 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            <FiRefreshCw size={13} />
          </button>
          <button
            type="button"
            onClick={onNewChat}
            className="flex h-7 w-7 items-center justify-center rounded-md text-accent hover:bg-canvas-surface-hover"
          >
            <FiPlus size={15} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-canvas-border border-t-canvas-muted" />
          </div>
        )}

        {!loading && sessions.length === 0 && (
          <div className="py-8 text-center">
            <p className="text-[12px] text-canvas-muted">No conversations yet</p>
            <button
              type="button"
              onClick={onNewChat}
              className="mt-3 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white active:opacity-80"
            >
              Start a chat
            </button>
          </div>
        )}

        {!loading && sessions.length > 0 && (
          <div className="space-y-0.5">
            {sessions.map((session) => {
              const isActive = session.sessionId === selectedSessionId;
              // Prefer the live status from the polling hook; fall back to
              // the legacy runningSessionIds boolean so any caller that
              // still populates it (or the replayed WS status from a fresh
              // reconnect) isn't ignored.
              const liveStatus = statuses[session.sessionId]?.status;
              const derivedStatus: SessionStatus | null =
                liveStatus && liveStatus !== "idle"
                  ? liveStatus
                  : runningSessionIds?.has(session.sessionId)
                    ? "thinking"
                    : null;
              const ui = derivedStatus ? STATUS_UI[derivedStatus] : null;
              return (
                <button
                  key={session.sessionId}
                  type="button"
                  onClick={() => onSelectSession(session.sessionId)}
                  className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                    isActive
                      ? "bg-canvas-surface-hover text-canvas-fg"
                      : "text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
                  }`}
                  title={ui?.label}
                >
                  {ui ? (
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ui.dotClass}`} />
                  ) : (
                    // Reserve the same width so titles stay aligned when a
                    // session flips idle → running → idle.
                    <span className="mt-1.5 h-2 w-2 shrink-0" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`line-clamp-1 text-[13px] ${isActive ? "font-medium" : ""}`}>
                      {session.display}
                    </p>
                    <p className="mt-0.5 text-[10px] text-canvas-muted">
                      {ui?.label ?? formatRelativeTime(session.timestamp)}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer — Settings */}
      <div className="shrink-0 border-t border-canvas-border px-2 py-2">
        <button
          type="button"
          onClick={openSettings}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
        >
          <FiSettings size={14} />
          Settings
        </button>
      </div>
    </div>
  );
}
