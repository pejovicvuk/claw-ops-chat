import { extractSession, unauthorized } from "@/lib/auth-server";
import {
  AgentConfigError,
  deleteSystemPromptAppend,
  loadSystemPromptAppend,
  saveSystemPromptAppend,
} from "@/lib/agent-config";

export async function GET(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const record = await loadSystemPromptAppend();
  return Response.json(record);
}

export async function POST(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  let body: { prompt?: unknown };
  try {
    body = (await request.json()) as { prompt?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.prompt !== "string") {
    return Response.json({ error: "prompt must be a string" }, { status: 400 });
  }
  try {
    await saveSystemPromptAppend(body.prompt);
  } catch (err) {
    if (err instanceof AgentConfigError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json({ error: "Failed to save prompt" }, { status: 500 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  await deleteSystemPromptAppend();
  return Response.json({ ok: true });
}
