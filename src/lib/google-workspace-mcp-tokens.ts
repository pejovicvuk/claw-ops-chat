import { existsSync } from "fs";
import { mkdir, readdir, unlink, writeFile, chmod } from "fs/promises";
import { join } from "path";
import { WORKSPACE_MCP_CREDS_DIR } from "./google-custom-config";

/**
 * Writes a workspace-mcp-compatible credential file so its `--single-user`
 * reader skips OAuth and uses tokens we obtained via the device flow.
 *
 * Format and filename must match workspace-mcp's
 * auth/credential_store.py:183 (`store_credential`):
 *   - Path:   <dir>/<safe_email>.json   where safe_email sanitizes per the
 *             same regex workspace-mcp uses.
 *   - Mode:   0600 (matches workspace-mcp's own writer).
 *   - Shape:  { token, refresh_token, token_uri, client_id, client_secret,
 *               scopes, expiry }  — consumed by google.oauth2.Credentials.
 *
 * Any drift from this shape causes workspace-mcp to silently ignore the
 * file and fall back to its own OAuth, which we can't complete on a remote
 * host.
 */

export interface WorkspaceMcpTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  scopes: string[];
}

export interface WorkspaceMcpCredsInput {
  email: string;
  clientId: string;
  clientSecret: string;
  tokens: WorkspaceMcpTokens;
}

const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";

/**
 * Mirror of workspace-mcp's sanitizer:
 * `re.sub(r"[^a-zA-Z0-9@._-]", "_", user_email)`.
 * Keeps the filename path-traversal-safe for both workspace-mcp's reader
 * (which validates the resolved path stays under the base dir) and for us.
 */
export function safeEmailFilename(email: string): string {
  return email.replace(/[^a-zA-Z0-9@._-]/g, "_");
}

export function credentialsPathFor(email: string): string {
  return join(WORKSPACE_MCP_CREDS_DIR, `${safeEmailFilename(email)}.json`);
}

/**
 * Persist tokens in the exact layout workspace-mcp expects. Wipes any stale
 * files in the dir before writing so `--single-user` picks the fresh one
 * deterministically (it reads the first file it finds, ordering undefined).
 */
export async function writeWorkspaceMcpCredentials(input: WorkspaceMcpCredsInput): Promise<string> {
  await mkdir(WORKSPACE_MCP_CREDS_DIR, { recursive: true, mode: 0o700 });

  // Wipe stale credential files so single-user mode doesn't pick up an old
  // account. We only manage one user here; any leftover file is noise.
  if (existsSync(WORKSPACE_MCP_CREDS_DIR)) {
    for (const name of await readdir(WORKSPACE_MCP_CREDS_DIR)) {
      if (name.endsWith(".json")) {
        await unlink(join(WORKSPACE_MCP_CREDS_DIR, name)).catch(() => {});
      }
    }
  }

  // workspace-mcp expects a timezone-naive ISO string (see
  // credential_store.py:158 — it strips tzinfo if present). Emitting a
  // naive local ISO matches what Python's datetime.fromisoformat returns.
  const expiry = new Date(Date.now() + input.tokens.expiresInSec * 1000)
    .toISOString()
    .replace(/Z$/, "");

  const body = {
    token: input.tokens.accessToken,
    refresh_token: input.tokens.refreshToken,
    token_uri: GOOGLE_TOKEN_URI,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    scopes: input.tokens.scopes,
    expiry,
  };

  const path = credentialsPathFor(input.email);
  await writeFile(path, JSON.stringify(body, null, 2), "utf-8");
  try {
    await chmod(path, 0o600);
  } catch {
    /* Windows doesn't support POSIX modes; ignore. */
  }
  return path;
}

/**
 * Delete the written credential file (used on Disconnect). Leaves the dir
 * itself in place — harmless empty directory, avoids racing with a fresh
 * re-auth.
 */
export async function deleteWorkspaceMcpCredentials(email?: string): Promise<void> {
  if (!existsSync(WORKSPACE_MCP_CREDS_DIR)) return;
  if (email) {
    await unlink(credentialsPathFor(email)).catch(() => {});
    return;
  }
  // No email → wipe everything (Disconnect case)
  for (const name of await readdir(WORKSPACE_MCP_CREDS_DIR).catch(() => [])) {
    if (name.endsWith(".json")) {
      await unlink(join(WORKSPACE_MCP_CREDS_DIR, name)).catch(() => {});
    }
  }
}

/** Returns true if ANY credential file exists in the workspace-mcp creds dir. */
export async function hasWorkspaceMcpCredentials(): Promise<boolean> {
  if (!existsSync(WORKSPACE_MCP_CREDS_DIR)) return false;
  const names = await readdir(WORKSPACE_MCP_CREDS_DIR).catch(() => []);
  return names.some((n) => n.endsWith(".json"));
}
