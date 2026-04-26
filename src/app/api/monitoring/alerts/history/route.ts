import { extractSession, unauthorized } from "@/lib/auth-server";
import { getAlertEngine } from "@/lib/monitoring/alerts/engine";

export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();
  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1),
    200,
  );
  const events = getAlertEngine().recentHistory(limit);
  return Response.json({ events });
}
