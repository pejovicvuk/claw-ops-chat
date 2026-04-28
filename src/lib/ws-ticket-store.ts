import { randomUUID } from "crypto";

/**
 * Short-lived WebSocket authentication tickets.
 *
 * The browser calls POST /api/auth/ws-ticket (authenticated via session
 * cookie) to obtain a UUID. The UUID is passed as `?ticket=<uuid>` on the
 * WebSocket upgrade URL and consumed (deleted) on first use. Tickets expire
 * after 60 seconds so they cannot accumulate in memory indefinitely.
 *
 * Pinned to `globalThis` for the same reason as scheduler-singleton and
 * session-manager-singleton: Next.js standalone builds duplicate module
 * instances between the custom server entry and the bundled API routes.
 * A plain module-local Map would never be visible to the API route that
 * issues tickets.
 */

const KEY = "__claw_ws_ticket_store__";
const TICKET_TTL_MS = 60_000; // 60 seconds

interface WsTicket {
  email: string;
  exp: number; // Date.now() + TICKET_TTL_MS
}

interface Global {
  [KEY]?: Map<string, WsTicket>;
}

function getStore(): Map<string, WsTicket> {
  const g = globalThis as Global;
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY];
}

/**
 * Issue a new single-use ticket for the given email. Returns the UUID
 * that the client should pass as `?ticket=` on the WebSocket URL.
 */
export function issueWsTicket(email: string): string {
  const ticket = randomUUID();
  getStore().set(ticket, { email, exp: Date.now() + TICKET_TTL_MS });
  return ticket;
}

/**
 * Validate and consume a ticket. Returns the email on success, null if
 * the ticket is unknown or has expired. Always deletes the ticket so it
 * cannot be reused even on validation failure (prevents timing oracle).
 */
export function consumeWsTicket(ticket: string): string | null {
  const store = getStore();
  const entry = store.get(ticket);
  store.delete(ticket); // one-time use — delete unconditionally
  if (!entry) return null;
  if (Date.now() > entry.exp) return null;
  return entry.email;
}
