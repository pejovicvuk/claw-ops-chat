import { extractSession, unauthorized } from "@/lib/auth-server";
import { clearLoginSession } from "@/lib/claude-auth-sessions";

/** Kill any active `claude auth login` child process for this user. */
export async function POST(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();

  const cleared = clearLoginSession(session.email);
  return Response.json({ ok: true, cleared });
}
