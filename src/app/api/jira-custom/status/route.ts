import { extractSession, unauthorized } from "@/lib/auth-server";
import { loadCredentials } from "@/lib/jira-custom-config";

export async function GET(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  const creds = await loadCredentials();
  return Response.json({
    saved: !!creds,
    domain: creds?.domain ?? null,
    email: creds?.email ?? null,
    displayName: creds?.displayName ?? null,
  });
}
