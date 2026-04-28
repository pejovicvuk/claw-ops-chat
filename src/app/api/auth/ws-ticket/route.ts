import { extractSession, unauthorized } from "@/lib/auth-server";
import { issueWsTicket } from "@/lib/ws-ticket-store";

/**
 * POST /api/auth/ws-ticket
 *
 * Issues a short-lived (60 s) single-use UUID that the client passes as
 * `?ticket=<uuid>` on the WebSocket upgrade URL instead of putting a
 * Bearer token in the query string (where it would appear in server logs
 * and browser history).
 *
 * Authentication: session cookie (HMAC-signed, HttpOnly).
 * The ticket is stored in a process-wide Map and consumed (deleted) by
 * the WebSocket upgrade handler on first use.
 */
export async function POST(request: Request): Promise<Response> {
  const session = extractSession(request);
  if (!session) return unauthorized();

  const ticket = issueWsTicket(session.email);
  return Response.json({ ticket });
}
