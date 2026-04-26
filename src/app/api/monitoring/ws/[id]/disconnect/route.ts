import { extractSession, unauthorized } from "@/lib/auth-server";
import { getAuditWriter } from "@/lib/audit/writer";
import { wsGetSession } from "@/lib/monitoring/ws-session-store";

declare global {
  var __clawForceDisconnectSession: ((id: string) => boolean) | undefined;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = extractSession(request);
  if (!session) return unauthorized();
  const { id } = await ctx.params;
  const target = wsGetSession(id);
  if (!target) return Response.json({ error: "Session not found" }, { status: 404 });
  const force = globalThis.__clawForceDisconnectSession;
  if (typeof force !== "function") {
    return Response.json({ error: "Force-disconnect bridge not initialized" }, { status: 503 });
  }
  const ok = force(id);
  await getAuditWriter()
    .api({
      type: ok ? "request_complete" : "request_error",
      severity: "warn",
      actor: session.email,
      subject: `monitoring.ws_disconnect: ${id.slice(0, 12)}`,
      durationMs: null,
      route: "/api/monitoring/ws/[id]/disconnect",
      method: "POST",
      statusCode: ok ? 200 : 500,
      target: id,
      details: { sessionId: id, ok },
    })
    .catch(() => {});
  return Response.json({ ok });
}
