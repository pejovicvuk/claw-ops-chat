import { existsSync } from "fs";
import { chmod, mkdir, readFile, unlink, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import {
  isMcpServerRegistered as isServerRegistered,
  registerMcpServer as registerServer,
  unregisterMcpServer as unregisterServer,
} from "./mcp-register";
import { MS365_SCOPE_STRING } from "./microsoft-custom-scopes";

export const MCP_SERVER_ID = "microsoft-custom";

const CREDENTIALS_DIR = join(homedir(), ".claude", "custom-microsoft");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");

const MS_TOKEN_ENDPOINT = (tenantId: string) =>
  `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

export interface MicrosoftCredentials {
  clientId: string;
  /** Optional — public client device flow works without a client secret. */
  clientSecret?: string;
  /** "common" | "organizations" | "consumers" | tenant GUID */
  tenantId: string;
  /** Bearer token embedded in the MCP server env block in ~/.claude.json */
  accessToken?: string;
  /** Used to obtain new access tokens when the current one expires */
  refreshToken?: string;
  /** Unix ms: Date.now() + expires_in * 1000 at token issuance */
  expiresAt?: number;
  /** userPrincipalName or mail from GET /v1.0/me — UI display only */
  accountEmail?: string;
  /** displayName from GET /v1.0/me — UI display only */
  displayName?: string;
}

export async function saveCredentials(creds: MicrosoftCredentials): Promise<void> {
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  await writeFile(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), "utf-8");
  try {
    await chmod(CREDENTIALS_FILE, 0o600);
  } catch {
    /* ignore — non-POSIX or already correct */
  }
}

export async function loadCredentials(): Promise<MicrosoftCredentials | null> {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  try {
    const raw = await readFile(CREDENTIALS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as MicrosoftCredentials;
    if (!parsed.clientId || !parsed.tenantId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function deleteCredentials(): Promise<void> {
  if (existsSync(CREDENTIALS_FILE)) {
    await unlink(CREDENTIALS_FILE).catch(() => {});
  }
}

export async function registerMcpServer(creds: MicrosoftCredentials): Promise<void> {
  const env: Record<string, string> = {
    MS365_MCP_CLIENT_ID: creds.clientId,
    MS365_MCP_TENANT_ID: creds.tenantId,
    MS365_MCP_OAUTH_TOKEN: creds.accessToken ?? "",
  };
  if (creds.clientSecret) {
    env.MS365_MCP_CLIENT_SECRET = creds.clientSecret;
  }
  await registerServer(MCP_SERVER_ID, {
    type: "stdio",
    command: "npx",
    args: ["-y", "@softeria/ms-365-mcp-server"],
    env,
  });
}

export async function unregisterMcpServer(): Promise<void> {
  await unregisterServer(MCP_SERVER_ID);
}

export async function isMcpServerRegistered(): Promise<boolean> {
  return isServerRegistered(MCP_SERVER_ID);
}

/**
 * Refresh the access token if it is expired or within 5 minutes of expiry.
 * On success, saves updated credentials and re-registers the MCP server so
 * the next SDK session picks up the fresh token from ~/.claude.json.
 * Returns the (possibly updated) credentials unchanged if the token is
 * still valid.
 */
export async function refreshAccessTokenIfNeeded(): Promise<MicrosoftCredentials> {
  const creds = await loadCredentials();
  if (!creds) throw new Error("No Microsoft credentials saved.");

  const FIVE_MIN_MS = 5 * 60 * 1000;
  const stillValid =
    typeof creds.expiresAt === "number" && Date.now() < creds.expiresAt - FIVE_MIN_MS;

  if (stillValid) return creds;

  if (!creds.refreshToken) {
    throw new Error(
      "Access token expired and no refresh token is available. " +
        "Please sign in again to restore access.",
    );
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: creds.clientId,
    refresh_token: creds.refreshToken,
    scope: MS365_SCOPE_STRING,
  });
  if (creds.clientSecret) {
    params.set("client_secret", creds.clientSecret);
  }

  let res: Response;
  try {
    res = await fetch(MS_TOKEN_ENDPOINT(creds.tenantId), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new Error(
      `Could not reach Microsoft to refresh token: ${
        err instanceof Error ? err.message : "network error"
      }`,
    );
  }

  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !data.access_token) {
    throw new Error(
      data.error_description ?? data.error ?? `Microsoft token refresh returned HTTP ${res.status}`,
    );
  }

  const updated: MicrosoftCredentials = {
    ...creds,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? creds.refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };

  await saveCredentials(updated);
  await registerMcpServer(updated);

  return updated;
}
