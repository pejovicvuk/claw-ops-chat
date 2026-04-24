import { extractSession, unauthorized } from "@/lib/auth-server";
import { AgentConfigError, deleteRule, readRule, updateRule } from "@/lib/agent-config";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const { name } = await params;
  try {
    const record = await readRule(name);
    return Response.json(record);
  } catch (err) {
    if (err instanceof AgentConfigError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json({ error: "Failed to read rule" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const { name } = await params;
  let body: { content?: unknown };
  try {
    body = (await request.json()) as { content?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.content !== "string") {
    return Response.json({ error: "content must be a string" }, { status: 400 });
  }
  try {
    await updateRule(name, body.content);
  } catch (err) {
    if (err instanceof AgentConfigError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json({ error: "Failed to update rule" }, { status: 500 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const { name } = await params;
  try {
    await deleteRule(name);
  } catch (err) {
    if (err instanceof AgentConfigError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json({ error: "Failed to delete rule" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
