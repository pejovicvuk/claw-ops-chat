import { extractSession, unauthorized } from "@/lib/auth-server";
import { loadCredentials } from "@/lib/microsoft-custom-config";
import { MS365_SCOPE_STRING } from "@/lib/microsoft-custom-scopes";

interface MsDeviceCodeResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  expires_in?: number;
  interval?: number;
  message?: string;
  error?: string;
  error_description?: string;
}

// No withAudit: this route reads credentials and calls Microsoft, but does
// not mutate any local state. The state-changing work happens in device-poll.
export async function POST(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  const creds = await loadCredentials();
  if (!creds) {
    return Response.json(
      { error: "No Azure App credentials saved yet. Enter them first." },
      { status: 400 },
    );
  }

  const body = new URLSearchParams({
    client_id: creds.clientId,
    scope: MS365_SCOPE_STRING,
  });

  let upstream: Response;
  try {
    upstream = await fetch(
      `https://login.microsoftonline.com/${creds.tenantId}/oauth2/v2.0/devicecode`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (err) {
    return Response.json(
      {
        error: `Could not reach Microsoft: ${
          err instanceof Error ? err.message : "network error"
        }`,
      },
      { status: 502 },
    );
  }

  const data = (await upstream.json().catch(() => ({}))) as MsDeviceCodeResponse;

  if (!upstream.ok || !data.device_code || !data.user_code) {
    const code = data.error ?? "";
    const desc = data.error_description ?? "";
    let friendly: string;

    if (code === "unauthorized_client" || desc.toLowerCase().includes("unauthorized_client")) {
      friendly =
        "This app is not authorized for the device code flow. " +
        "In Azure Portal, go to App Registration → Authentication → Advanced settings " +
        "and set 'Allow public client flows' to Yes.";
    } else if (code === "invalid_client" || desc.toLowerCase().includes("invalid client")) {
      friendly =
        "The Client ID was rejected by Microsoft. Verify it matches the Application (client) ID " +
        "shown in Azure Portal → App Registrations → your app → Overview.";
    } else if (
      code === "tenant_discovery_failure" ||
      desc.toLowerCase().includes("tenant") ||
      desc.toLowerCase().includes("aadsts90002")
    ) {
      friendly =
        `Tenant ID '${creds.tenantId}' was not found. ` +
        "Use 'common' for personal + org accounts, or paste your tenant's GUID from " +
        "Azure Portal → Microsoft Entra ID → Overview.";
    } else {
      friendly = desc || code || `Microsoft returned HTTP ${upstream.status} without a device code.`;
    }

    return Response.json(
      { error: friendly },
      { status: upstream.ok ? 502 : upstream.status },
    );
  }

  return Response.json({
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUrl: data.verification_uri ?? "https://microsoft.com/devicelogin",
    expiresIn: data.expires_in ?? 900,
    interval: data.interval ?? 5,
    message: data.message ?? null,
  });
}
