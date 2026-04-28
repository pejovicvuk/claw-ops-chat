import { extractSession, unauthorized } from "@/lib/auth-server";
import {
  isMcpServerRegistered,
  loadCredentials,
  refreshAccessTokenIfNeeded,
} from "@/lib/microsoft-custom-config";

export async function GET(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  const [creds, registered] = await Promise.all([
    loadCredentials(),
    isMcpServerRegistered(),
  ]);

  if (!creds) {
    return Response.json({
      connected: false,
      credentialsSaved: false,
      accountEmail: null,
      displayName: null,
      tokenExpired: false,
    });
  }

  // Credentials saved but device flow not yet completed.
  if (!creds.accessToken) {
    return Response.json({
      connected: false,
      credentialsSaved: true,
      accountEmail: creds.accountEmail ?? null,
      displayName: creds.displayName ?? null,
      tokenExpired: false,
    });
  }

  // Proactively refresh the token when it is expired or nearly so.
  // This keeps ~/.claude.json up-to-date so the next SDK session picks
  // up a valid token without any user action.
  let refreshError: string | undefined;
  let updatedCreds = creds;
  let tokenExpired = false;
  try {
    updatedCreds = await refreshAccessTokenIfNeeded();
  } catch (err) {
    refreshError = err instanceof Error ? err.message : "Token refresh failed";
    tokenExpired = true;
  }

  return Response.json({
    connected: !tokenExpired && registered,
    credentialsSaved: true,
    accountEmail: updatedCreds.accountEmail ?? null,
    displayName: updatedCreds.displayName ?? null,
    tokenExpired,
    ...(refreshError ? { refreshError } : {}),
  });
}
