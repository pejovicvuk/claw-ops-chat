import { extractSession, unauthorized } from "@/lib/auth-server";
import { clearPrereqSession } from "@/lib/prereq-sessions";

/** Kill any active `uv` install child process for this user. */
export async function POST(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();

  const cleared = clearPrereqSession(session.email, "uv");
  return Response.json({ ok: true, cleared });
}
