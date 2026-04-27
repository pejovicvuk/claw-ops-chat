import { extractSession, unauthorized } from "@/lib/auth-server";
import { listRecentRuns } from "@/lib/monitoring/automation/store";

export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();
  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1),
    200,
  );
  const runs = await listRecentRuns(limit);
  return Response.json({ runs });
}
