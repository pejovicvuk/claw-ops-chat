import { extractSession, unauthorized } from "@/lib/auth-server";
import {
  loadCredentials,
  saveCredentials,
  type GoogleClientType,
} from "@/lib/google-custom-config";

/**
 * Accept either:
 *   { clientId, clientSecret, clientType? }  — legacy two-field path
 *   { json: "<raw credentials.json>" }       — new paste-the-JSON path
 *
 * The JSON path accepts both Google OAuth client shapes:
 *   { "installed": { client_id, client_secret, ... } }  → Desktop (device flow)
 *   { "web":       { client_id, client_secret, ... } }  → Web (redirect flow)
 */

interface GoogleClientJson {
  installed?: { client_id?: string; client_secret?: string };
  web?: { client_id?: string; client_secret?: string };
}

function parseGoogleClientJson(raw: string): {
  clientId: string;
  clientSecret: string;
  clientType: GoogleClientType;
} | null {
  try {
    const parsed = JSON.parse(raw) as GoogleClientJson;
    if (parsed.installed?.client_id && parsed.installed.client_secret) {
      return {
        clientId: parsed.installed.client_id,
        clientSecret: parsed.installed.client_secret,
        clientType: "installed",
      };
    }
    if (parsed.web?.client_id && parsed.web.client_secret) {
      return {
        clientId: parsed.web.client_id,
        clientSecret: parsed.web.client_secret,
        clientType: "web",
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!extractSession(request)) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as {
    clientId?: string;
    clientSecret?: string;
    clientType?: GoogleClientType;
    json?: string;
  };

  let clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  let clientSecret = typeof body.clientSecret === "string" ? body.clientSecret.trim() : "";
  let clientType: GoogleClientType | undefined =
    body.clientType === "installed" || body.clientType === "web" ? body.clientType : undefined;

  // JSON-paste path wins when provided — simpler UX and matches exactly what
  // Google Cloud Console hands the user.
  if (typeof body.json === "string" && body.json.trim()) {
    const parsed = parseGoogleClientJson(body.json);
    if (!parsed) {
      return Response.json(
        {
          error:
            "Could not find client_id / client_secret in the pasted JSON. " +
            'Expect a shape like { "installed": { client_id, client_secret, ... } } ' +
            'or { "web": { ... } }.',
        },
        { status: 400 },
      );
    }
    clientId = parsed.clientId;
    clientSecret = parsed.clientSecret;
    clientType = parsed.clientType;
  }

  if (!clientId || !clientSecret) {
    return Response.json(
      { error: "Both clientId and clientSecret are required (either as fields or inside `json`)." },
      { status: 400 },
    );
  }

  // Preserve any already-signed-in email across a creds update — e.g. the
  // user edited the client secret; we don't want to lose their account link.
  const existing = await loadCredentials();
  const accountEmail = existing?.accountEmail;

  try {
    await saveCredentials({
      clientId,
      clientSecret,
      clientType: clientType ?? existing?.clientType ?? "web",
      ...(accountEmail ? { accountEmail } : {}),
    });
    return Response.json({ ok: true, clientType: clientType ?? existing?.clientType ?? "web" });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to save credentials" },
      { status: 500 },
    );
  }
}
