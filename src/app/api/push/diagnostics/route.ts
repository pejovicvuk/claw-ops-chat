import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { recentSends } from "@/lib/push/diagnostics";

async function getHandler(request: Request): Promise<Response> {
  const session = extractSession(request);
  if (!session) return unauthorized();
  const url = new URL(request.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.min(50, Math.max(1, Number.parseInt(limitRaw ?? "20", 10) || 20));
  const entries = recentSends(session.email, limit);
  return Response.json({ entries });
}

export const GET = withAudit(
  { route: "/api/push/diagnostics", subjectFrom: () => null },
  getHandler,
);
