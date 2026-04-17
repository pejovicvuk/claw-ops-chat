import { extractSession, unauthorized } from "@/lib/auth-server";
import { clearMcpAuthSession, type McpAuthServiceId } from "@/lib/mcp-auth-sessions";

/** Kill any active `claude mcp add` child process for this user + service. */
export async function POST(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as { id?: string };
  const id = body.id;
  if (id !== "gmail" && id !== "google-drive" && id !== "google-calendar") {
    return Response.json({ error: "Invalid service id" }, { status: 400 });
  }
  const serviceId: McpAuthServiceId = id;

  const cleared = clearMcpAuthSession(session.email, serviceId);
  return Response.json({ ok: true, cleared });
}
