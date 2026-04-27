import { extractSession, unauthorized } from "@/lib/auth-server";
import { getAuditWriter } from "@/lib/audit/writer";
import { getAutomationEngine } from "@/lib/monitoring/automation/engine";
import { createRule, listRecentRuns, listRules } from "@/lib/monitoring/automation/store";
import type { AutomationRule, RuleKind } from "@/lib/monitoring/automation/types";

const VALID_KINDS: RuleKind[] = [
  "schedule_prune_docker_logs",
  "schedule_prune_docker_images",
  "schedule_trim_audit",
  "schedule_trim_cache",
  "schedule_trim_heap_snapshots",
  "schedule_trim_monitoring_history",
  "trigger_force_gc",
  "trigger_drop_fs_caches",
  "trigger_restart_unhealthy_container",
];

interface RuleInput {
  name?: unknown;
  kind?: unknown;
  enabled?: unknown;
  cron?: unknown;
  trigger?: {
    metric?: unknown;
    operator?: unknown;
    threshold?: unknown;
    forMs?: unknown;
  };
  cooldownMs?: unknown;
  options?: unknown;
  runbookUrl?: unknown;
}

export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();
  const [rules, runs] = await Promise.all([listRules(), listRecentRuns(50)]);
  return Response.json({ rules, runs });
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
    ...validation.value,
    createdBy: session.email,
  });
  await getAutomationEngine().reconcileRules();
  await getAuditWriter()
    .alert({
      type: "rule_created",
      severity: "info",
      actor: session.email,
      subject: `Automation rule created: ${rule.name}`,
      durationMs: null,
      ruleId: rule.id,
      ruleName: rule.name,
      details: { kind: rule.kind, cron: rule.cron, trigger: rule.trigger },
    })
    .catch(() => {});
  return Response.json(rule, { status: 201 });
}

function validate(
  body: RuleInput,
):
  | { ok: true; value: Omit<AutomationRule, "id" | "createdAt" | "updatedAt" | "createdBy"> }
  | { ok: false; error: string } {
  if (typeof body.name !== "string" || !body.name.trim())
    return { ok: false, error: "name required" };
  if (typeof body.kind !== "string" || !VALID_KINDS.includes(body.kind as RuleKind))
    return { ok: false, error: `kind must be one of: ${VALID_KINDS.join(", ")}` };
  const kind = body.kind as RuleKind;
  const isSchedule = kind.startsWith("schedule_");
  const isTrigger = kind.startsWith("trigger_");
  if (isSchedule) {
    if (typeof body.cron !== "string" || !body.cron.trim())
      return { ok: false, error: "cron required for schedule kinds" };
  }
  if (isTrigger) {
    const t = body.trigger;
    if (
      !t ||
      typeof t.metric !== "string" ||
      typeof t.operator !== "string" ||
      typeof t.threshold !== "number" ||
      typeof t.forMs !== "number"
    ) {
      return { ok: false, error: "trigger required for trigger kinds" };
    }
  }
  const cooldownMs =
    typeof body.cooldownMs === "number" && body.cooldownMs >= 0 ? body.cooldownMs : 10 * 60 * 1000;
  return {
    ok: true,
    value: {
      name: body.name.trim().slice(0, 100),
      kind,
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
      cron: isSchedule ? (body.cron as string) : undefined,
      trigger: isTrigger
        ? {
            metric: body.trigger!.metric as string,
            operator: body.trigger!.operator as ">" | "<" | ">=" | "<=" | "==",
            threshold: body.trigger!.threshold as number,
            forMs: body.trigger!.forMs as number,
          }
        : undefined,
      cooldownMs,
      options:
        typeof body.options === "object" && body.options !== null
          ? (body.options as Record<string, unknown>)
          : {},
      runbookUrl: typeof body.runbookUrl === "string" ? body.runbookUrl.slice(0, 500) : undefined,
    },
  };
}
