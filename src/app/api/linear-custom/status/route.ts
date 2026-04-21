import { extractSession, unauthorized } from "@/lib/auth-server";
import { loadCredentials, isMcpServerRegistered } from "@/lib/linear-custom-config";

export async function GET(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  const creds = await loadCredentials();
  const registered = await isMcpServerRegistered();

  return Response.json({
    tokenSaved: !!creds,
    registered,
    email: creds?.email ?? null,
    name: creds?.name ?? null,
  });
}
