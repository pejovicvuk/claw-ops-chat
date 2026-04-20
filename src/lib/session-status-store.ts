/**
 * Shared in-memory store for per-session status so both the WebSocket
 * server (server.ts) and the Next.js API routes can agree on "what is
 * Claude doing right now in session X?" without a round-trip to disk.
 *
 * The chat app's custom server.ts and Next.js API routes run in the
 * same Node process, so a module-level singleton is actually shared.
 *
 * Status values — kept broader than strictly necessary so the sidebar
 * can render a useful dot even mid-tool:
 *   - "idle"                  default, nothing running
 *   - "thinking"              query in flight, streaming text
 *   - "tool-running"          a tool is currently executing
 *   - "awaiting-permission"   waiting for the user to allow/deny a tool
 *   - "awaiting-input"        AskUserQuestion pending
 */

// Wire format matches the existing WebSocket status messages in
// src/lib/use-claude-chat.ts — keep underscore_case for compatibility.
export type SessionStatus =
  | "idle"
  | "thinking"
  | "tool_running"
  | "awaiting_permission"
  | "awaiting_input";

export interface SessionStatusEntry {
  status: SessionStatus;
  lastActivityAt: number;
}

const store = new Map<string, SessionStatusEntry>();

export function setSessionStatus(sessionId: string, status: SessionStatus): void {
  store.set(sessionId, { status, lastActivityAt: Date.now() });
}

export function clearSessionStatus(sessionId: string): void {
  store.delete(sessionId);
}

export function getSessionStatus(sessionId: string): SessionStatusEntry | undefined {
  return store.get(sessionId);
}

/**
 * Snapshot of every active session's status. Used by the
 * /api/sessions/status endpoint that the sidebar polls.
 */
export function getAllSessionStatuses(): Record<string, SessionStatusEntry> {
  const out: Record<string, SessionStatusEntry> = {};
  for (const [id, entry] of store) {
    out[id] = entry;
  }
  return out;
}
