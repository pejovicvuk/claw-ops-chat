import { extractSession, unauthorized } from "@/lib/auth-server";
import { loadCredentials } from "@/lib/bitbucket-custom-config";

export async function GET(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  const creds = await loadCredentials();
  return Response.json({
    saved: !!creds,
    email: creds?.email ?? null,
    workspace: creds?.workspace ?? null,
    displayName: creds?.displayName ?? null,
  });
}
