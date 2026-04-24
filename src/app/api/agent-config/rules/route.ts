import { extractSession, unauthorized } from "@/lib/auth-server";
import { AgentConfigError, createRule, listRules } from "@/lib/agent-config";

export async function GET(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const items = await listRules();
  return Response.json({ items });
}

export async function POST(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  let body: { name?: unknown; content?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; content?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.name !== "string" || typeof body.content !== "string") {
    return Response.json({ error: "name and content are required" }, { status: 400 });
  }
  try {
    await createRule(body.name, body.content);
  } catch (err) {
    if (err instanceof AgentConfigError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json({ error: "Failed to create rule" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
