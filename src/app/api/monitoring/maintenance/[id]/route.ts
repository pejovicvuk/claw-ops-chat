import { extractSession, unauthorized } from "@/lib/auth-server";
import { getAuditWriter } from "@/lib/audit/writer";
import { deleteWindow, getWindow, updateWindow } from "@/lib/monitoring/maintenance/store";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!extractSession(request)) return unauthorized();
  const { id } = await ctx.params;
  const window = await getWindow(id);
  if (!window) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(window);
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = extractSession(request);
  if (!session) return unauthorized();
  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const updated = await updateWindow(id, body);
  if (!updated) return Response.json({ error: "Not found" }, { status: 404 });
  await getAuditWriter()
    .alert({
      type: "rule_updated",
      severity: "info",
      actor: session.email,
      subject: `Maintenance window updated: ${updated.name}`,
      durationMs: null,
      ruleId: updated.id,
      ruleName: updated.name,
      details: { fields: Object.keys(body) },
    })
    .catch(() => {});
  return Response.json(updated);
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = extractSession(request);
  if (!session) return unauthorized();
  const { id } = await ctx.params;
  const existing = await getWindow(id);
  const ok = await deleteWindow(id);
  if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
  await getAuditWriter()
    .alert({
      type: "rule_deleted",
      severity: "info",
      actor: session.email,
      subject: `Maintenance window deleted: ${existing?.name ?? id}`,
      durationMs: null,
      ruleId: id,
      ruleName: existing?.name,
      details: {},
    })
    .catch(() => {});
  return Response.json({ ok: true });
}
