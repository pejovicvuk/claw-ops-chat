import { extractSession, unauthorized } from "@/lib/auth-server";
import { getLoginSession } from "@/lib/claude-auth-sessions";

/**
 * Relay the OAuth code from the browser to the running `claude auth login`
 * child process's stdin. The SSE stream from /login will emit the eventual
 * "done" event when the child exits.
 */
export async function POST(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (!code) {
    return Response.json({ error: "Code is required" }, { status: 400 });
  }

  const loginSession = getLoginSession(session.email);
  if (!loginSession) {
    return Response.json(
      { error: "No active login session. Start the login flow first." },
      { status: 404 },
    );
  }

  const stdin = loginSession.process.stdin;
  if (!stdin || stdin.destroyed) {
    return Response.json({ error: "Login process is not accepting input" }, { status: 409 });
  }

  stdin.write(`${code}\n`);

  return Response.json({ ok: true });
}
