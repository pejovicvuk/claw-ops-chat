import { extractSession, unauthorized } from "@/lib/auth-server";
import { getAuditWriter } from "@/lib/audit/writer";

export async function POST(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();
  if (typeof globalThis.gc !== "function") {
    return Response.json(
      {
        error: "Force GC unavailable. Restart Node with --expose-gc to enable.",
      },
      { status: 400 },
    );
  }
  const before = process.memoryUsage().rss;
  globalThis.gc();
  const after = process.memoryUsage().rss;
  await getAuditWriter()
    .api({
      type: "request_complete",
      severity: "info",
      actor: session.email,
      subject: `monitoring.force_gc → ${(after - before).toLocaleString()} bytes`,
      durationMs: 0,
      route: "/api/monitoring/actions/force-gc",
      method: "POST",
      statusCode: 200,
      details: { freedBytes: before - after },
    })
    .catch(() => {});
  return Response.json({ ok: true, freedBytes: before - after });
}
