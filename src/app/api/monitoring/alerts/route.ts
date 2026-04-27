import { extractSession, unauthorized } from "@/lib/auth-server";
import { getAuditWriter } from "@/lib/audit/writer";
import { getAlertEngine } from "@/lib/monitoring/alerts/engine";
import { KNOWN_METRICS } from "@/lib/monitoring/alerts/metric-lookup";
import { createRule, listRules } from "@/lib/monitoring/alerts/store";
import type { AlertOperator, AlertRule, AlertSeverity } from "@/lib/monitoring/types";

const VALID_OPERATORS: AlertOperator[] = [">", "<", ">=", "<=", "=="];
const VALID_SEVERITY: AlertSeverity[] = ["warning", "critical"];

interface RuleInput {
  name?: unknown;
  enabled?: unknown;
  metric?: unknown;
  operator?: unknown;
  threshold?: unknown;
  forMs?: unknown;
  severity?: unknown;
  notify?: { webPush?: unknown; webhook?: { url?: unknown } };
  runbookUrl?: unknown;
}

export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();
  const rules = await listRules();
  const firing = getAlertEngine().currentlyFiring();
  return Response.json({ rules, firing, knownMetrics: KNOWN_METRICS });
}

export async function POST(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();
  let body: RuleInput;
  try {
    body = (await request.json()) as RuleInput;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const validation = validate(body);
  if (!validation.ok) return Response.json({ error: validation.error }, { status: 400 });
  const rule = await createRule({
    name: validation.value.name,
    enabled: validation.value.enabled,
    metric: validation.value.metric,
    operator: validation.value.operator,
    threshold: validation.value.threshold,
    forMs: validation.value.forMs,
    severity: validation.value.severity,
    notify: validation.value.notify,
    createdBy: session.email,
  });
  await getAuditWriter()
    .alert({
      type: "rule_created",
      severity: "info",
      actor: session.email,
      subject: `Alert rule created: ${rule.name}`,
      durationMs: null,
      ruleId: rule.id,
      ruleName: rule.name,
      metric: rule.metric,
      thresholdValue: rule.threshold,
      details: {
        operator: rule.operator,
        threshold: rule.threshold,
        forMs: rule.forMs,
        severity: rule.severity,
      },
    })
    .catch(() => {});
  return Response.json(rule, { status: 201 });
}

function validate(
  body: RuleInput,
):
  | { ok: true; value: Omit<AlertRule, "id" | "createdAt" | "updatedAt" | "createdBy"> }
  | { ok: false; error: string } {
  if (typeof body.name !== "string" || !body.name.trim())
    return { ok: false, error: "name required" };
  if (typeof body.metric !== "string" || !body.metric.trim())
    return { ok: false, error: "metric required" };
  // Allow either a known dotted-path metric OR the special audit.count() form.
  const isAuditCount = /^audit\.count\(.+\)$/.test(body.metric);
  if (!isAuditCount && !KNOWN_METRICS.includes(body.metric as string))
    return {
      ok: false,
      error: `metric must be one of: ${KNOWN_METRICS.join(", ")} or audit.count(...)`,
    };
  if (
    typeof body.operator !== "string" ||
    !VALID_OPERATORS.includes(body.operator as AlertOperator)
  )
    return { ok: false, error: `operator must be one of: ${VALID_OPERATORS.join(", ")}` };
  if (typeof body.threshold !== "number" || !Number.isFinite(body.threshold))
    return { ok: false, error: "threshold must be a number" };
  if (typeof body.forMs !== "number" || body.forMs < 0)
    return { ok: false, error: "forMs must be a non-negative number" };
  if (typeof body.severity !== "string" || !VALID_SEVERITY.includes(body.severity as AlertSeverity))
    return { ok: false, error: `severity must be one of: ${VALID_SEVERITY.join(", ")}` };
  return {
    ok: true,
    value: {
      name: body.name.trim().slice(0, 100),
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
      metric: body.metric as string,
      operator: body.operator as AlertOperator,
      threshold: body.threshold,
      forMs: Math.min(body.forMs, 24 * 60 * 60 * 1000),
      severity: body.severity as AlertSeverity,
      notify: {
        webPush: Boolean(body.notify?.webPush ?? true),
        webhook:
          typeof body.notify?.webhook?.url === "string" && body.notify.webhook.url.trim()
            ? { url: (body.notify.webhook.url as string).trim() }
            : undefined,
      },
      runbookUrl: typeof body.runbookUrl === "string" ? body.runbookUrl.slice(0, 500) : undefined,
    },
  };
}
