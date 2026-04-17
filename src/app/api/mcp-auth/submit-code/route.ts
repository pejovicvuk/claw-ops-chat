import { extractSession, unauthorized } from "@/lib/auth-server";
import { getMcpAuthSession, type McpAuthServiceId } from "@/lib/mcp-auth-sessions";

/**
 * Relay the OAuth code from the browser to the running `claude mcp add`
 * child process's stdin. The SSE stream from /connect will emit the eventual
 * "done" event when the child exits.
 */
export async function POST(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as { id?: string; code?: string };
  const id = body.id;
  if (id !== "gmail" && id !== "google-drive" && id !== "google-calendar") {
    return Response.json({ error: "Invalid service id" }, { status: 400 });
  }
  const serviceId: McpAuthServiceId = id;

  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) {
    return Response.json({ error: "Code is required" }, { status: 400 });
  }

  const authSession = getMcpAuthSession(session.email, serviceId);
  if (!authSession) {
    return Response.json(
      { error: "No active connect session. Start the flow first." },
      { status: 404 },
    );
  }

  const stdin = authSession.process.stdin;
  if (!stdin || stdin.destroyed) {
    return Response.json({ error: "Process is not accepting input" }, { status: 409 });
  }

  stdin.write(`${code}\n`);

  return Response.json({ ok: true });
}
