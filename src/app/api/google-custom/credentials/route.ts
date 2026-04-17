import { extractSession, unauthorized } from "@/lib/auth-server";
import { saveCredentials } from "@/lib/google-custom-config";

export async function POST(request: Request) {
  if (!extractSession(request)) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as {
    clientId?: string;
    clientSecret?: string;
  };

  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  const clientSecret = typeof body.clientSecret === "string" ? body.clientSecret.trim() : "";

  if (!clientId || !clientSecret) {
    return Response.json({ error: "Both clientId and clientSecret are required" }, { status: 400 });
  }

  try {
    await saveCredentials({ clientId, clientSecret });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to save credentials" },
      { status: 500 },
    );
  }
}
