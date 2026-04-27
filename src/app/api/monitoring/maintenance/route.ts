import { extractSession, unauthorized } from "@/lib/auth-server";
import { getAuditWriter } from "@/lib/audit/writer";
import { createWindow, listWindows } from "@/lib/monitoring/maintenance/store";
import type { MaintenanceWindow } from "@/lib/monitoring/types";

interface WindowInput {
  name?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  recurringCron?: unknown;
  recurringDurationMs?: unknown;
  ruleIds?: unknown;
  reason?: unknown;
}

export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();
  const windows = await listWindows();
  return Response.json({ windows });
}

export async function POST(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();
  let body: WindowInput;
  try {
    body = (await request.json()) as WindowInput;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.name !== "string" || !body.name.trim())
    return Response.json({ error: "name required" }, { status: 400 });
  if (typeof body.startsAt !== "number" || typeof body.endsAt !== "number")
    return Response.json({ error: "startsAt and endsAt (ms epoch) required" }, { status: 400 });
  if (body.endsAt <= body.startsAt)
    return Response.json({ error: "endsAt must be after startsAt" }, { status: 400 });
  const input: Omit<MaintenanceWindow, "id" | "createdAt" | "updatedAt"> = {
    name: body.name.trim().slice(0, 100),
    startsAt: body.startsAt,
    endsAt: body.endsAt,
    recurringCron:
      typeof body.recurringCron === "string" ? body.recurringCron.slice(0, 100) : undefined,
    recurringDurationMs:
      typeof body.recurringDurationMs === "number" ? body.recurringDurationMs : undefined,
    ruleIds:
      Array.isArray(body.ruleIds) && body.ruleIds.every((r) => typeof r === "string")
        ? (body.ruleIds as string[])
        : undefined,
    reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : undefined,
    createdBy: session.email,
  };
  const window = await createWindow(input);
  await getAuditWriter()
    .alert({
      type: "rule_created",
      severity: "info",
      actor: session.email,
      subject: `Maintenance window created: ${window.name}`,
      durationMs: null,
      ruleId: window.id,
      ruleName: window.name,
      details: {
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        ruleIds: window.ruleIds ?? [],
      },
    })
    .catch(() => {});
  return Response.json(window, { status: 201 });
}
