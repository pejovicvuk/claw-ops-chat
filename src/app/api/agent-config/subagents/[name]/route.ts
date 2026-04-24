import { extractSession, unauthorized } from "@/lib/auth-server";
import { AgentConfigError, deleteSubagent, readSubagent, updateSubagent } from "@/lib/agent-config";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const { name } = await params;
  try {
    const record = await readSubagent(name);
    return Response.json(record);
  } catch (err) {
    if (err instanceof AgentConfigError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json({ error: "Failed to read subagent" }, { status: 500 });
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
    await updateSubagent(name, body.content);
  } catch (err) {
    if (err instanceof AgentConfigError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json({ error: "Failed to update subagent" }, { status: 500 });
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
    await deleteSubagent(name);
  } catch (err) {
    if (err instanceof AgentConfigError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json({ error: "Failed to delete subagent" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
