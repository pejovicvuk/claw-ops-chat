import { extractSession, unauthorized } from "@/lib/auth-server";
import { loadCredentials } from "@/lib/google-custom-config";
import { GOOGLE_DEVICE_FLOW_SCOPE_STRING } from "@/lib/google-custom-scopes";

/**
 * Start Google's Device Authorization Flow (RFC 8628).
 *
 *   POST /chat/api/google-custom/device-start
 *   → { userCode, verificationUrl, verificationUrlComplete,
 *       deviceCode, expiresIn, interval }
 *
 * Used specifically for Desktop OAuth clients — Google's Cloud Console
 * won't let Desktop clients register a public https redirect URI, so the
 * redirect-based flow can't work with them. Device flow doesn't need any
 * redirect URI: the server shows the user a code + URL, the user signs in
 * on any device with their org email, and the server polls for the token.
 *
 * The returned `deviceCode` is a short-lived single-use secret the client
 * passes back to `/device-poll`. We deliberately don't persist it
 * server-side — any replay is already blocked by Google once it's
 * redeemed, and passing it through the client keeps the polling endpoint
 * stateless.
 */

const DEVICE_CODE_ENDPOINT = "https://oauth2.googleapis.com/device/code";

interface GoogleDeviceCodeResponse {
  device_code?: string;
  user_code?: string;
  verification_url?: string;
  verification_url_complete?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
  error_description?: string;
}

export async function POST(request: Request) {
  if (!extractSession(request)) return unauthorized();

  const creds = await loadCredentials();
  if (!creds) {
    return Response.json(
      { error: "No Google credentials saved yet. Paste your credentials.json first." },
      { status: 400 },
    );
  }

  // Device flow is for Desktop clients. Web clients have a working redirect
  // flow elsewhere; surfacing this explicitly avoids silent behavior drift.
  if (creds.clientType !== "installed") {
    return Response.json(
      {
        error:
          "Device flow is only for Desktop OAuth clients. The saved credentials " +
          "look like a Web client — use the redirect-based sign-in instead.",
      },
      { status: 400 },
    );
  }

  const body = new URLSearchParams({
    client_id: creds.clientId,
    scope: GOOGLE_DEVICE_FLOW_SCOPE_STRING,
  });

  let upstream: Response;
  try {
    upstream = await fetch(DEVICE_CODE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (err) {
    return Response.json(
      {
        error: `Could not reach Google: ${
          err instanceof Error ? err.message : "unknown network error"
        }`,
      },
      { status: 502 },
    );
  }

  const data = (await upstream.json().catch(() => ({}))) as GoogleDeviceCodeResponse;

  if (!upstream.ok || !data.device_code || !data.user_code) {
    // Google returns `{ error: "invalid_client", error_description: "Invalid
    // client type" }` when the OAuth client is registered as "Desktop app"
    // (or Web application) — the device flow is only accepted for clients
    // registered as "TVs and Limited Input devices". Both Desktop and TV
    // clients produce identical credentials.json shapes (top-level
    // "installed" key), so we can't detect this client-side; we only see
    // it when Google rejects the request. Translate the terse Google
    // message into something actionable.
    const rawDesc = data.error_description || "";
    const desc = rawDesc.toLowerCase();
    const code = (data.error || "").toLowerCase();
    const isInvalidClientType = desc.includes("invalid client type") || code === "invalid_client";
    // Google's device flow only permits a small whitelist of scopes: identity
    // (openid / email / profile), YouTube, and file-scoped Drive
    // (drive.file / drive.appdata). Workspace scopes — Gmail, Calendar, full
    // Drive, Docs, Sheets — are not on that list, so there is *no* workable
    // device-flow configuration for a Google Workspace MCP. The only way
    // forward is a Web-application OAuth client with a registered redirect
    // URI. Surface that instead of the terse "Invalid device flow scope"
    // Google hands back.
    const isScopeRejection = desc.includes("invalid device flow scope") || code === "invalid_scope";
    let friendly: string;
    if (isScopeRejection) {
      friendly =
        "Google's device flow doesn't support Workspace scopes (Gmail, Calendar, " +
        "Drive, Docs, Sheets) — only identity + YouTube + file-scoped Drive. " +
        "That rules out using the device flow for workspace-mcp. " +
        "Switch to a Web-application OAuth client: Google Cloud Console → " +
        "Credentials → Create credentials → OAuth client ID → Web application, " +
        "add 'https://<your-host>/chat/api/google-custom/oauth-callback' as an " +
        "authorized redirect URI, download the JSON, paste it here, then use the " +
        "'Run Setup in Terminal' path that appears for Web clients." +
        (rawDesc ? ` (Google said: ${rawDesc})` : "");
    } else if (isInvalidClientType) {
      friendly =
        "Your OAuth client was created as 'Desktop app' (or 'Web application'). " +
        "Google's device flow only accepts clients registered as " +
        "'TVs and Limited Input devices'. Go to Google Cloud Console → " +
        "Credentials → Create credentials → OAuth client ID → pick " +
        "'TVs and Limited Input devices', download that JSON, and paste it " +
        "back into the credentials box above.";
    } else {
      friendly =
        rawDesc || data.error || `Google returned HTTP ${upstream.status} without a device code.`;
    }
    return Response.json(
      { error: friendly },
      { status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502 },
    );
  }

  return Response.json({
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUrl: data.verification_url ?? "https://www.google.com/device",
    verificationUrlComplete:
      data.verification_url_complete ?? data.verification_url ?? "https://www.google.com/device",
    expiresIn: data.expires_in ?? 1800,
    // Google's recommended minimum poll interval. Clients must honor the
    // `slow_down` response by doubling this when it comes back.
    interval: data.interval ?? 5,
  });
}
