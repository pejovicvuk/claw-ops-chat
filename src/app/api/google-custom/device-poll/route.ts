import { extractSession, unauthorized } from "@/lib/auth-server";
import { loadCredentials, registerMcpServer, saveCredentials } from "@/lib/google-custom-config";
import { writeWorkspaceMcpCredentials } from "@/lib/google-workspace-mcp-tokens";
import { GOOGLE_DEVICE_FLOW_SCOPES } from "@/lib/google-custom-scopes";

/**
 * Poll Google's token endpoint for the device flow.
 *
 *   POST /chat/api/google-custom/device-poll
 *   body: { deviceCode }
 *   → { status: "pending" | "slow_down" | "success" | "error",
 *       email?, error? }
 *
 * The client calls this on a timer (interval returned by device-start).
 * On success we synchronously:
 *   1. Fetch the user's email via userinfo.
 *   2. Write workspace-mcp's credential file (so it skips its own OAuth).
 *   3. Persist the email alongside the OAuth client creds.
 *   4. Register / update the MCP server entry in ~/.claude.json.
 *
 * Doing all of this in one request (instead of chaining more endpoints)
 * means a single success response leaves the server in a fully-usable
 * state — the wizard can just show "Signed in ✓" and move on.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfoResponse {
  email?: string;
  email_verified?: boolean;
  error?: { message?: string };
}

export async function POST(request: Request) {
  if (!extractSession(request)) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as { deviceCode?: string };
  const deviceCode = typeof body.deviceCode === "string" ? body.deviceCode.trim() : "";
  if (!deviceCode) {
    return Response.json({ error: "deviceCode is required" }, { status: 400 });
  }

  const creds = await loadCredentials();
  if (!creds) {
    return Response.json(
      { error: "Google credentials were removed while the device flow was in progress." },
      { status: 400 },
    );
  }
  if (creds.clientType !== "installed") {
    return Response.json(
      { error: "Device flow is only valid for Desktop OAuth clients." },
      { status: 400 },
    );
  }

  // Single-shot token exchange. Google returns a specific error body when
  // the user hasn't finished approving yet — we translate the standard
  // device-flow errors into explicit statuses for the client.
  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      device_code: deviceCode,
      grant_type: DEVICE_CODE_GRANT,
    }),
  }).catch((err: unknown) => {
    throw new Error(`Could not reach Google: ${err instanceof Error ? err.message : "network"}`);
  });

  const tokenData = (await tokenRes.json().catch(() => ({}))) as GoogleTokenResponse;

  // RFC 8628 device-flow error semantics:
  //   authorization_pending → keep polling at current interval
  //   slow_down             → keep polling, but double the interval
  //   access_denied         → user said no
  //   expired_token         → device_code / user_code timed out
  if (!tokenRes.ok) {
    if (tokenData.error === "authorization_pending") {
      return Response.json({ status: "pending" });
    }
    if (tokenData.error === "slow_down") {
      return Response.json({ status: "slow_down" });
    }
    return Response.json({
      status: "error",
      error:
        tokenData.error_description || tokenData.error || `Google returned HTTP ${tokenRes.status}`,
    });
  }

  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token;
  if (!accessToken || !refreshToken) {
    return Response.json({
      status: "error",
      error:
        "Google returned a token response without a refresh_token. " +
        "Revoke the app in your Google Account → Security → Third-party access and try again.",
    });
  }

  // Who signed in? We need the email to key workspace-mcp's credential
  // filename (its `--single-user` reader loads by filename) and to display
  // in the UI.
  const userInfoRes = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const userInfo = (await userInfoRes.json().catch(() => ({}))) as GoogleUserInfoResponse;
  const email = typeof userInfo.email === "string" ? userInfo.email : "";
  if (!email) {
    return Response.json({
      status: "error",
      error: `Could not read the user's email from Google (HTTP ${userInfoRes.status}).`,
    });
  }

  // Google's `scope` response is space-separated; fall back to our requested
  // set so workspace-mcp's `has_required_scopes` check succeeds even when
  // Google decides to omit implied scopes from the response.
  const returnedScopes = tokenData.scope
    ? tokenData.scope.split(/\s+/).filter(Boolean)
    : GOOGLE_DEVICE_FLOW_SCOPES;

  try {
    await writeWorkspaceMcpCredentials({
      email,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      tokens: {
        accessToken,
        refreshToken,
        expiresInSec: tokenData.expires_in ?? 3600,
        scopes: returnedScopes,
      },
    });
  } catch (err) {
    return Response.json({
      status: "error",
      error: `Saved the tokens but could not write the workspace-mcp credential file: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }

  // Remember the email on the creds record so future registerMcpServer
  // calls can pass USER_GOOGLE_EMAIL and the UI can surface the account.
  const credsWithEmail = { ...creds, accountEmail: email };
  await saveCredentials(credsWithEmail);
  await registerMcpServer(credsWithEmail);

  return Response.json({ status: "success", email });
}
