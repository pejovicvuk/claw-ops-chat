import { extractSession, unauthorized } from "@/lib/auth-server";
import { getAutomationEngine } from "@/lib/monitoring/automation/engine";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = extractSession(request);
  if (!session) return unauthorized();
  const { id } = await ctx.params;
  const result = await getAutomationEngine().runNow(id, session.email);
  if ("error" in result) return Response.json(result, { status: 404 });
  return Response.json(result);
}
