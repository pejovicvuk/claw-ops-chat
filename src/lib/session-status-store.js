"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.setSessionStatus = setSessionStatus;
exports.clearSessionStatus = clearSessionStatus;
exports.getSessionStatus = getSessionStatus;
exports.getAllSessionStatuses = getAllSessionStatuses;
const store =
  globalThis.__clawSessionStatusStore ?? (globalThis.__clawSessionStatusStore = new Map());
function setSessionStatus(sessionId, status) {
  store.set(sessionId, { status, lastActivityAt: Date.now() });
  if (process.env.DEBUG_SESSION_STATUS === "1") {
    // Opt-in log so operators can confirm the status pipeline is alive
    // when users report "no indicators". Keep behind an env flag so prod
    // isn't drowning in tiny writes.
    console.log(`[status] ${sessionId.slice(0, 8)}… → ${status} (total=${store.size})`);
  }
}
function clearSessionStatus(sessionId) {
  store.delete(sessionId);
}
function getSessionStatus(sessionId) {
  return store.get(sessionId);
}
/**
 * Snapshot of every active session's status. Used by the
 * /api/sessions/status endpoint that the sidebar polls.
 */
function getAllSessionStatuses() {
  const out = {};
  for (const [id, entry] of store) {
    out[id] = entry;
  }
  if (process.env.DEBUG_SESSION_STATUS === "1") {
    const active = Object.values(out).filter((e) => e.status !== "idle").length;
    console.log(`[status] GET /sessions/status → ${store.size} entries, ${active} active`);
  }
  return out;
}
