import { extractSession, unauthorized } from "@/lib/auth-server";
import { getAuditWriter } from "@/lib/audit/writer";
import { updateRule } from "@/lib/monitoring/alerts/store";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = extractSession(request);
  if (!session) return unauthorized();
  const { id } = await ctx.params;
  let body: { forMs?: unknown };
  try {
    body = (await request.json()) as { forMs?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const forMs = typeof body.forMs === "number" && body.forMs > 0 ? body.forMs : 60 * 60 * 1000;
  const snoozedUntil = Date.now() + Math.min(forMs, 24 * 60 * 60 * 1000);
  const updated = await updateRule(id, { snoozedUntil });
  if (!updated) return Response.json({ error: "Not found" }, { status: 404 });
  await getAuditWriter()
    .alert({
      type: "alert_snoozed",
      severity: "info",
      actor: session.email,
      subject: `Alert snoozed: ${updated.name}`,
      durationMs: null,
      ruleId: id,
      ruleName: updated.name,
      details: { snoozedUntil, forMs },
    })
    .catch(() => {});
  return Response.json({ ok: true, snoozedUntil });
}
