import { extractSession, unauthorized } from "@/lib/auth-server";
import { getAuditWriter } from "@/lib/audit/writer";
import { getRule } from "@/lib/monitoring/alerts/store";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = extractSession(request);
  if (!session) return unauthorized();
  const { id } = await ctx.params;
  const rule = await getRule(id);
  if (!rule) return Response.json({ error: "Not found" }, { status: 404 });
  await getAuditWriter()
    .alert({
      type: "alert_acked",
      severity: "info",
      actor: session.email,
      subject: `Alert acknowledged: ${rule.name}`,
      durationMs: null,
      ruleId: id,
      ruleName: rule.name,
      details: { ackedBy: session.email, ackedAt: Date.now() },
    })
    .catch(() => {});
  return Response.json({ ok: true });
}
