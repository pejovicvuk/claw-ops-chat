"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FiAlertTriangle,
  FiFolder,
  FiLoader,
  FiPlus,
  FiRefreshCw,
  FiSettings,
  FiTrash2,
} from "react-icons/fi";
import type { ChatSession } from "@/lib/types";
import { useUrlState } from "@/lib/use-url-state";
import { useSessionStatuses } from "@/lib/use-session-statuses";
import { useDesktopNotifications } from "@/lib/use-desktop-notifications";
import { useExitAnimation } from "@/lib/use-exit-animation";
import type { SessionStatus } from "@/lib/session-status-store";

/**
 * Per-status visuals. Colours are applied via inline style (not Tailwind
 * arbitrary classes) so the Tailwind JIT can't silently miss them —
 * earlier attempts with `border-blue-400` + `border-l-[3px]` were either
 * purged in production builds or rendered invisible against the dark
 * background. A 4px solid left border + matching text colour is hard to
 * miss. `awaiting_*` stay static so blocked sessions demand attention;
 * `thinking` / `tool_running` pulse gently via CSS keyframe.
 */
const STATUS_UI: Record<
  Exclude<SessionStatus, "idle">,
  { color: string; label: string; pulse: boolean }
> = {
  thinking: { color: "#60a5fa", label: "Thinking", pulse: true }, // blue-400
  tool_running: { color: "#c084fc", label: "Running tool", pulse: true }, // purple-400
  awaiting_permission: { color: "#fb923c", label: "Needs permission", pulse: false }, // orange-400
  awaiting_input: { color: "#fbbf24", label: "Needs input", pulse: false }, // amber-400
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
  /** When true, the component renders only the list (Sidebar supplies its own header). */
  hideHeader?: boolean;
  /** When true, the Settings footer row is omitted (Sidebar supplies its own). */
  hideFooter?: boolean;
  /**
   * Delete a session end-to-end (JSONL transcript + our persistence +
   * status-store entry). Should refresh the session list on completion
   * and, if the deleted session was selected, navigate the user to a
   * fresh chat. Optional — when absent the context-menu item hides.
   */
  onDeleteSession?: (sessionId: string) => Promise<void>;
}

interface ContextMenuState {
  sessionId: string;
  sessionDisplay: string;
  x: number;
  y: number;
}

export function SessionList({
  selectedSessionId,
  onSelectSession,
  onNewChat,
  sessions,
  loading,
  onRefresh,
  runningSessionIds,
  hideHeader = false,
  hideFooter = false,
  onDeleteSession,
}: SessionListProps) {
  const { setParam } = useUrlState();
  const openSettings = () => setParam("settings", "main");
  const statuses = useSessionStatuses();
  const { notify } = useDesktopNotifications();

  /**
   * Fire a desktop notification whenever a session transitions INTO an
   * awaiting_permission / awaiting_input state while the tab is hidden.
   * Only the transition matters — we don't re-notify on every 2 s poll
   * while the state sticks. Stored per-session in a ref so we don't
   * re-render when the snapshot updates.
   */
  const prevStatusRef = useRef<Record<string, SessionStatus>>({});
  useEffect(() => {
    const prev = prevStatusRef.current;
    for (const [sid, entry] of Object.entries(statuses)) {
      const s = entry.status;
      const was = prev[sid];
      if ((s === "awaiting_permission" || s === "awaiting_input") && was !== s) {
        const display = sessions.find((x) => x.sessionId === sid)?.display || "Chat";
        void notify({
          title:
            s === "awaiting_permission" ? `${display} needs approval` : `${display} needs input`,
          body:
            s === "awaiting_permission"
              ? "Claude is waiting for you to allow or deny a tool."
              : "Claude is waiting for your answer.",
          tag: `claw-chat:${sid}:${s}`,
          onClick: () => {
            setParam("chat", sid);
          },
        });
      }
      prev[sid] = s;
    }
    for (const sid of Object.keys(prev)) {
      if (!(sid in statuses)) delete prev[sid];
    }
  }, [statuses, sessions, notify, setParam]);

  const activeCount = Object.values(statuses).filter((s) => s.status !== "idle").length;

  // ─── Context menu state ─────────────────────────────────────────
  //
  // A single right-click menu per list (not per row) — open at mouse
  // position, flip back to null on close. Mirrors the file-browser
  // pattern in file-browser.tsx:106 so the animation vocabulary
  // (animate-menu-in / animate-menu-out) and the mouse-coordinate
  // positioning stay consistent across the app.

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  // Mirror the last non-null value in state (not a ref) so the exit
  // animation can still render after setContextMenu(null) clears the
  // current state. Reading a ref during render trips react-hooks/refs,
  // while a plain state read is fine.
  const [lastContextMenu, setLastContextMenu] = useState<ContextMenuState | null>(null);
  useEffect(() => {
    if (!contextMenu) return;
    // Defer the mirror update a microtask so the linter's
    // "setState-in-effect" rule is satisfied — an imperceptible delay
    // since the exit animation waits 140ms before unmount anyway.
    const t = setTimeout(() => setLastContextMenu(contextMenu), 0);
    return () => clearTimeout(t);
  }, [contextMenu]);
  const { mounted: menuMounted, state: menuAnim } = useExitAnimation(contextMenu !== null, 140);

  const closeMenu = useCallback(() => setContextMenu(null), []);

  // Dismiss on outside click / Escape / scroll. Scope listeners to
  // only attach while the menu is actually open so we're not burning
  // event bandwidth the rest of the time.
  useEffect(() => {
    if (!contextMenu) return;
    const onClickAway = () => closeMenu();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("click", onClickAway);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClickAway, true);
    return () => {
      window.removeEventListener("click", onClickAway);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClickAway, true);
    };
  }, [contextMenu, closeMenu]);

  const openContextMenu = useCallback((e: React.MouseEvent, session: ChatSession) => {
    e.preventDefault();
    // Clamp to viewport so menus near the right / bottom edge don't
    // overflow — 200 ≈ menu width, 140 ≈ menu height.
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - 140);
    setContextMenu({ sessionId: session.sessionId, sessionDisplay: session.display, x, y });
  }, []);

  // ─── Delete-confirm modal state ─────────────────────────────────

  const [pendingDelete, setPendingDelete] = useState<{
    sessionId: string;
    display: string;
    error: string | null;
    busy: boolean;
  } | null>(null);
  const { mounted: confirmMounted, state: confirmAnim } = useExitAnimation(
    pendingDelete !== null,
    140,
  );
  const [lastPendingDelete, setLastPendingDelete] = useState<typeof pendingDelete>(null);
  useEffect(() => {
    if (!pendingDelete) return;
    const t = setTimeout(() => setLastPendingDelete(pendingDelete), 0);
    return () => clearTimeout(t);
  }, [pendingDelete]);

  const confirmDelete = useCallback(async () => {
    const p = pendingDelete;
    if (!p || !onDeleteSession) return;
    setPendingDelete({ ...p, busy: true, error: null });
    try {
      await onDeleteSession(p.sessionId);
      setPendingDelete(null);
    } catch (err) {
      setPendingDelete({
        ...p,
        busy: false,
        error: err instanceof Error ? err.message : "Failed to delete",
      });
    }
  }, [pendingDelete, onDeleteSession]);

  // Close confirm on Escape for keyboard users. Click-outside is
  // handled by the backdrop; don't also bind a window listener here
  // or the two close paths race.
  useEffect(() => {
    if (!pendingDelete) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pendingDelete.busy) setPendingDelete(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingDelete]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!hideHeader && (
        <div className="flex shrink-0 items-center justify-between border-b border-canvas-border px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-canvas-fg">Chats</span>
            {activeCount > 0 && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                style={{ backgroundColor: "#3b82f633", color: "#60a5fa" }}
                title={`${activeCount} session(s) currently doing something`}
              >
                {activeCount} active
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onRefresh}
              className="btn-press flex h-7 w-7 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
            >
              <FiRefreshCw size={13} />
            </button>
            <button
              type="button"
              onClick={onNewChat}
              className="btn-press flex h-7 w-7 items-center justify-center rounded-md text-accent hover:bg-canvas-surface-hover"
            >
              <FiPlus size={15} />
            </button>
          </div>
        </div>
      )}

      <div className={hideHeader ? "flex-1" : "flex-1 overflow-y-auto px-2 py-2"}>
        {loading && (
          <div className="space-y-1.5 px-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-12 rounded-lg bg-canvas-surface-hover/50 animate-pulse"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
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
              // the legacy `runningSessionIds` boolean so any caller that
              // still populates it (e.g. replayed WS status from a fresh
              // reconnect) isn't ignored.
              const liveStatus = statuses[session.sessionId]?.status;
              const derivedStatus: SessionStatus | null =
                liveStatus && liveStatus !== "idle"
                  ? liveStatus
                  : runningSessionIds?.has(session.sessionId)
                    ? "thinking"
                    : null;
              const ui = derivedStatus ? STATUS_UI[derivedStatus] : null;
              const rowStyle: React.CSSProperties = ui
                ? {
                    borderLeftWidth: 4,
                    borderLeftStyle: "solid",
                    borderLeftColor: ui.color,
                  }
                : {
                    borderLeftWidth: 4,
                    borderLeftStyle: "solid",
                    borderLeftColor: "transparent",
                  };
              return (
                <button
                  key={session.sessionId}
                  type="button"
                  onClick={() => onSelectSession(session.sessionId)}
                  onContextMenu={(e) => openContextMenu(e, session)}
                  className={`row-hover focus-ring flex w-full items-start gap-2 rounded-lg pl-2.5 pr-3 py-2 text-left transition-colors ${
                    isActive
                      ? "bg-canvas-surface-hover text-canvas-fg"
                      : "text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
                  } ${ui?.pulse ? "animate-session-active" : ""}`}
                  style={rowStyle}
                  title={ui?.label}
                >
                  <div className="min-w-0 flex-1">
                    <p className={`line-clamp-1 text-[13px] ${isActive ? "font-medium" : ""}`}>
                      {session.display}
                    </p>
                    <p className="mt-0.5 text-[10px]" style={ui ? { color: ui.color } : undefined}>
                      {ui?.label ?? formatRelativeTime(session.timestamp)}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Context menu — right-click on a row, fixed-positioned at the
          mouse. Click-outside + Escape + scroll close it. Reuses the
          same animation classes as file-browser's menu so both feel
          part of the same system. */}
      {menuMounted &&
        lastContextMenu &&
        (() => {
          const menu = lastContextMenu;
          const animClass = menuAnim === "exiting" ? "animate-menu-out" : "animate-menu-in";
          return (
            <div
              className={`fixed rounded-md border border-canvas-border bg-canvas-bg py-1 shadow-lg ${animClass}`}
              style={{ left: menu.x, top: menu.y, zIndex: 9999, minWidth: 180 }}
              role="menu"
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.preventDefault()}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onSelectSession(menu.sessionId);
                  closeMenu();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-canvas-fg hover:bg-canvas-surface-hover"
              >
                <FiFolder size={12} />
                Open
              </button>
              {onDeleteSession && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPendingDelete({
                      sessionId: menu.sessionId,
                      display: menu.sessionDisplay,
                      error: null,
                      busy: false,
                    });
                    closeMenu();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-red-400 hover:bg-canvas-surface-hover"
                >
                  <FiTrash2 size={12} />
                  Delete
                </button>
              )}
            </div>
          );
        })()}

      {/* Delete confirmation — modal with backdrop. Blocks the rest of
          the UI until the user commits or cancels. Shows the error
          inline instead of a toast so the failure stays tied to the
          action that produced it. */}
      {confirmMounted &&
        lastPendingDelete &&
        (() => {
          const p = lastPendingDelete;
          const animClass = confirmAnim === "exiting" ? "animate-fade-out" : "animate-fade-in";
          const panelAnim = confirmAnim === "exiting" ? "animate-modal-out" : "animate-modal-in";
          return (
            <div
              className={`fixed inset-0 z-[9998] flex items-center justify-center bg-black/40 backdrop-blur-[2px] ${animClass}`}
              onClick={() => {
                if (pendingDelete && !pendingDelete.busy) setPendingDelete(null);
              }}
            >
              <div
                className={`mx-4 w-full max-w-sm rounded-xl border border-canvas-border bg-canvas-bg p-5 shadow-2xl ${panelAnim}`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3 flex items-center gap-2">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-full"
                    style={{ backgroundColor: "color-mix(in srgb, #f87171 15%, transparent)" }}
                  >
                    <FiAlertTriangle size={14} className="text-red-400" />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-canvas-fg">Delete this chat?</p>
                    <p className="text-[11px] text-canvas-muted">This can&apos;t be undone.</p>
                  </div>
                </div>

                <div className="mb-4 rounded-md border border-canvas-border bg-canvas-surface-hover px-3 py-2">
                  <p className="line-clamp-2 text-[12px] text-canvas-fg">{p.display}</p>
                </div>

                {p.error && (
                  <p className="mb-3 flex items-start gap-1 text-[11px] text-red-400">
                    <FiAlertTriangle size={10} className="mt-[2px] shrink-0" />
                    {p.error}
                  </p>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingDelete(null)}
                    disabled={p.busy}
                    className="rounded-md px-3 py-1.5 text-[12px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmDelete}
                    disabled={p.busy}
                    className="inline-flex items-center gap-1.5 rounded-md bg-red-500/90 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-60"
                  >
                    {p.busy ? (
                      <>
                        <FiLoader size={11} className="animate-spin" />
                        Deleting…
                      </>
                    ) : (
                      <>
                        <FiTrash2 size={11} />
                        Delete
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* Footer — Settings */}
      {!hideFooter && (
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
      )}
    </div>
  );
}
