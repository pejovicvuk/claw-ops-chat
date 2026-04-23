import { extractSession, unauthorized } from "@/lib/auth-server";
import { readIndex } from "@/lib/reports/run-store";

/**
 * Sidebar feed: every run across every job, newest-first, read/unread
 * flag included. Supports `?unreadOnly=1` for the unread count badge.
 */
export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();
  const index = await readIndex();
  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get("unreadOnly") === "1";
  const entries = unreadOnly ? index.runs.filter((e) => e.readAt === null) : index.runs;
  const unreadCount = index.runs.filter((e) => e.readAt === null).length;
  return Response.json({ runs: entries, unreadCount });
}
