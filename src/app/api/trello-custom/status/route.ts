import { extractSession, unauthorized } from "@/lib/auth-server";
import { loadCredentials } from "@/lib/trello-custom-config";

export async function GET(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  const creds = await loadCredentials();
  return Response.json({
    saved: !!creds,
    username: creds?.username ?? null,
    fullName: creds?.fullName ?? null,
  });
}
