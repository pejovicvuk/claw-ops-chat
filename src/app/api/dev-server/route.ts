import { extractSession, unauthorized } from "@/lib/auth-server";
import { list } from "@/lib/dev-server/manager";

/**
 * GET /api/dev-server — list every currently-running dev server.
 *
 * Single-user model — no per-actor scoping. The PreviewWindow polls
 * this every few seconds to keep its Start/Stop button state in sync
 * with whatever's actually spawned. Read-only — no audit by default.
 */

export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();
  return Response.json({ servers: list() });
}
