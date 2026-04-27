import { extractSession, unauthorized } from "@/lib/auth-server";
import { getAuditWriter } from "@/lib/audit/writer";
import { updateRule } from "@/lib/monitoring/alerts/store";

interface BulkAckBody {
  ruleIds?: unknown;
  /** "ack" or "snooze". For "snooze", `forMs` is required. */
  action?: unknown;
  forMs?: unknown;
}

export async function POST(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();
  let body: BulkAckBody;
  try {
    body = (await request.json()) as BulkAckBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.ruleIds) || body.ruleIds.length === 0)
    return Response.json({ error: "ruleIds required" }, { status: 400 });
  const ids = body.ruleIds.filter((x): x is string => typeof x === "string");
  if (ids.length === 0)
    return Response.json({ error: "ruleIds must be non-empty strings" }, { status: 400 });

  const action = body.action === "snooze" ? "snooze" : "ack";
  const forMs =
    typeof body.forMs === "number" && body.forMs > 0
      ? Math.min(body.forMs, 24 * 60 * 60 * 1000)
      : 60 * 60 * 1000;

  const succeeded: string[] = [];
  const failed: string[] = [];
  for (const id of ids) {
    if (action === "snooze") {
      const updated = await updateRule(id, { snoozedUntil: Date.now() + forMs });
      (updated ? succeeded : failed).push(id);
    } else {
      // For "ack" we just write an audit entry — rules don't have an
      // intrinsic ack flag (events are derived from in-memory engine state).
      succeeded.push(id);
    }
  }
  await getAuditWriter()
    .alert({
      type: action === "snooze" ? "alert_snoozed" : "alert_acked",
      severity: "info",
      actor: session.email,
      subject: `Bulk ${action} on ${succeeded.length} rule(s)`,
      durationMs: null,
      ruleId: succeeded.join(","),
      details: { action, succeeded, failed, forMs },
    })
    .catch(() => {});
  return Response.json({ succeeded, failed, action, forMs });
}
