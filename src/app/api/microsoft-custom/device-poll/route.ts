import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import {
  loadCredentials,
  registerMcpServer,
  saveCredentials,
  type MicrosoftCredentials,
} from "@/lib/microsoft-custom-config";

const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

interface MsTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface MsUserResponse {
  userPrincipalName?: string;
  mail?: string;
  displayName?: string;
}

async function pollHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  let body: { deviceCode?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const deviceCode = typeof body.deviceCode === "string" ? body.deviceCode.trim() : "";
  if (!deviceCode) {
    return Response.json({ error: "deviceCode is required" }, { status: 400 });
  }

  const creds = await loadCredentials();
  if (!creds) {
    return Response.json(
      { error: "Credentials were removed while the device flow was running." },
      { status: 400 },
    );
  }

  const params = new URLSearchParams({
    grant_type: DEVICE_CODE_GRANT,
    client_id: creds.clientId,
    device_code: deviceCode,
  });
  if (creds.clientSecret) {
    params.set("client_secret", creds.clientSecret);
  }

  let tokenRes: Response;
  try {
    tokenRes = await fetch(
      `https://login.microsoftonline.com/${creds.tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (err) {
    return Response.json(
      {
        status: "error",
        error: `Network error reaching Microsoft: ${
          err instanceof Error ? err.message : "unknown"
        }`,
      },
      { status: 502 },
    );
  }

  const tokenData = (await tokenRes.json().catch(() => ({}))) as MsTokenResponse;

  if (!tokenRes.ok) {
    switch (tokenData.error) {
      case "authorization_pending":
        return Response.json({ status: "pending" });
      case "slow_down":
        return Response.json({ status: "slow_down" });
      case "expired_token":
        return Response.json({
          status: "error",
          error: "The sign-in code expired. Click 'Sign in with Microsoft' again to get a new one.",
        });
      case "access_denied":
        return Response.json({
          status: "error",
          error: "You declined the authorization request. Click 'Sign in' again if you want to connect.",
        });
      default:
        return Response.json({
          status: "error",
          error:
            tokenData.error_description ??
            tokenData.error ??
            `Microsoft returned HTTP ${tokenRes.status}`,
        });
    }
  }

  const accessToken = tokenData.access_token;
  if (!accessToken) {
    return Response.json({
      status: "error",
      error: "Microsoft returned a token response without an access_token. Please try again.",
    });
  }

  // Fetch display name and email from Graph API — failure is non-fatal.
  let accountEmail: string | undefined;
  let displayName: string | undefined;
  try {
    const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (meRes.ok) {
      const me = (await meRes.json()) as MsUserResponse;
      accountEmail = me.mail ?? me.userPrincipalName;
      displayName = me.displayName;
    }
  } catch {
    /* user info is UI-only; proceed without it */
  }

  const updated: MicrosoftCredentials = {
    ...creds,
    accessToken,
    ...(tokenData.refresh_token ? { refreshToken: tokenData.refresh_token } : {}),
    expiresAt: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
    ...(accountEmail ? { accountEmail } : {}),
    ...(displayName ? { displayName } : {}),
  };

  await saveCredentials(updated);
  await registerMcpServer(updated);

  return Response.json({
    status: "success",
    accountEmail: accountEmail ?? null,
    displayName: displayName ?? null,
  });
}

export const POST = withAudit(
  { route: "/api/microsoft-custom/device-poll", label: "Microsoft 365 device poll" },
  pollHandler,
);
