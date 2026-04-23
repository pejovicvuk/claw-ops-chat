import { extractSession, unauthorized } from "@/lib/auth-server";
import { loadCredentials } from "@/lib/google-custom-config";
import { GOOGLE_DEVICE_FLOW_SCOPES } from "@/lib/google-custom-scopes";
import { issueOauthState } from "@/lib/google-custom-oauth-state";

/**
 * Kick off the server-side web-redirect OAuth flow for Web-application
 * OAuth clients. Returns the Google consent URL for the wizard to open
 * in a new tab.
 *
 * Why a new endpoint instead of letting workspace-mcp drive the flow:
 * workspace-mcp runs its own callback server on localhost:8765 and
 * expects the whole handshake to complete inside its process — that
 * worked behind an nginx proxy to /oauth2callback, but breaks whenever
 * the deployed setup script, the reverse proxy, and workspace-mcp's
 * env vars drift out of sync (which is exactly what was happening).
 * Doing the handshake ourselves collapses that to a single code path:
 * Google redirects straight to /chat/api/google-custom/oauth-callback,
 * we exchange the code, write tokens into the file workspace-mcp reads
 * at startup, done.
 *
 * Response:
 *   { authUrl, state }  — the UI opens authUrl in a new tab. `state`
 *   is echoed back for the wizard's status-poll logic.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const CALLBACK_PATH = "/chat/api/google-custom/oauth-callback";

/** Build the public base URL the same way the existing setup-script route does. */
function resolvePublicBase(request: Request): string {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const proto =
    request.headers.get("x-forwarded-proto") ||
    (host && !host.startsWith("localhost") ? "https" : "http");
  if (host) return `${proto}://${host}`;
  return (process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:3100").replace(/\/+$/, "");
}

export async function POST(request: Request) {
  if (!extractSession(request)) return unauthorized();

  const creds = await loadCredentials();
  if (!creds) {
    return Response.json(
      { error: "No Google credentials saved yet. Upload your credentials.json first." },
      { status: 400 },
    );
  }

  // A Web OAuth client is required — only Web clients can register a public
  // https redirect URI, which is what we need Google to hit.
  if (creds.clientType !== "web") {
    return Response.json(
      {
        error:
          "This sign-in path needs a Web-application OAuth client, but the saved " +
          "credentials look like an installed (Desktop / TVs) client. Re-upload " +
          "a Web-application credentials.json and try again.",
      },
      { status: 400 },
    );
  }

  const redirectUri = `${resolvePublicBase(request)}${CALLBACK_PATH}`;
  const state = issueOauthState();

  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_DEVICE_FLOW_SCOPES.join(" "),
    // `offline` + `prompt=consent` is how Google gives us a refresh_token.
    // Without these, repeat sign-ins return only a short-lived access
    // token and workspace-mcp silently fails once it expires.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });

  return Response.json({
    authUrl: `${AUTH_ENDPOINT}?${params.toString()}`,
    redirectUri,
    state,
  });
}
