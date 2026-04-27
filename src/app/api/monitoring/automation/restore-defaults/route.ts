import { extractSession, unauthorized } from "@/lib/auth-server";
import { getAuditWriter } from "@/lib/audit/writer";
import { getAutomationEngine } from "@/lib/monitoring/automation/engine";
import { ensureDefaults } from "@/lib/monitoring/automation/store";

export async function POST(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();
  const result = await ensureDefaults();
  await getAutomationEngine().reconcileRules();
  await getAuditWriter()
    .alert({
      type: "rule_created",
      severity: "info",
      actor: session.email,
      subject: `Automation defaults restored (${result.added} added)`,
      durationMs: null,
      ruleId: "defaults",
      details: { added: result.added },
    })
    .catch(() => {});
  return Response.json(result);
}
