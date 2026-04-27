import { existsSync } from "fs";
import { mkdir, readFile, writeFile, chmod, unlink } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";

/**
 * Helpers for the custom Google Workspace MCP setup — stores OAuth credentials
 * and manages the corresponding entry in ~/.claude.json.
 *
 * Credentials file: ~/.claude/custom-google-workspace/credentials.json (mode 0600)
 * MCP server ID:    "google-workspace-custom"
 * workspace-mcp tokens: WORKSPACE_MCP_CREDENTIALS_DIR/<sanitized-email>.json
 */

export const MCP_SERVER_ID = "google-workspace-custom";

/**
 * workspace-mcp tool tier. "complete" exposes every Gmail / Drive / Calendar /
 * Docs / Sheets / Slides / Forms / Tasks / Contacts tool the server ships
 * (drafts, label/filter management, permission management, batch ops, …).
 * Any args entry pinning a different tier in ~/.claude.json is treated as
 * legacy and rewritten by `migrateGoogleMcpTier()`.
 */
export const WORKSPACE_MCP_TOOL_TIER = "complete" as const;

const CREDENTIALS_DIR = join(homedir(), ".claude", "custom-google-workspace");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");
const CLAUDE_JSON = join(homedir(), ".claude.json");

/**
 * Directory where we store workspace-mcp's per-user token files. This path is
 * passed to workspace-mcp via the WORKSPACE_MCP_CREDENTIALS_DIR env var, so
 * our device-flow result and workspace-mcp's own reader see the same location.
 */
export const WORKSPACE_MCP_CREDS_DIR = join(
  homedir(),
  ".claude",
  "custom-google-workspace",
  "tokens",
);

export type GoogleClientType = "installed" | "web";

export interface Credentials {
  clientId: string;
  clientSecret: string;
  /**
   * Shape of the Google OAuth client. "installed" = Desktop app (uses device
   * flow); "web" = Web application (uses redirect flow). Defaults to "web"
   * when loading a credentials file written before this field existed.
   */
  clientType?: GoogleClientType;
  /** Email of the Google account currently signed in via device flow. */
  accountEmail?: string;
}

/** Save OAuth credentials to the local credentials file (mode 0600). */
export async function saveCredentials(creds: Credentials): Promise<void> {
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  await writeFile(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), "utf-8");
  // Best-effort chmod — not enforced on Windows.
  try {
    await chmod(CREDENTIALS_FILE, 0o600);
  } catch {
    /* ignore */
  }
}

/** Load stored credentials, or null if not configured. */
export async function loadCredentials(): Promise<Credentials | null> {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  try {
    const raw = await readFile(CREDENTIALS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Credentials;
    if (!parsed.clientId || !parsed.clientSecret) return null;
    // Default to "web" for files written before clientType existed — that's
    // what the redirect-based flow assumed.
    if (!parsed.clientType) parsed.clientType = "web";
    return parsed;
  } catch {
    return null;
  }
}

/** Delete stored credentials. */
export async function deleteCredentials(): Promise<void> {
  if (existsSync(CREDENTIALS_FILE)) {
    await unlink(CREDENTIALS_FILE).catch(() => {});
  }
}

interface ClaudeJson {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Read ~/.claude.json; returns {} if missing or invalid. */
async function readClaudeJson(): Promise<ClaudeJson> {
  if (!existsSync(CLAUDE_JSON)) return {};
  try {
    const raw = await readFile(CLAUDE_JSON, "utf-8");
    return JSON.parse(raw) as ClaudeJson;
  } catch {
    return {};
  }
}

/** Write ~/.claude.json (preserving all other keys), ensuring parent dir exists. */
async function writeClaudeJson(data: ClaudeJson): Promise<void> {
  await mkdir(dirname(CLAUDE_JSON), { recursive: true });
  await writeFile(CLAUDE_JSON, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Add or overwrite the custom Google Workspace MCP entry in ~/.claude.json.
 *
 * Always sets WORKSPACE_MCP_CREDENTIALS_DIR so workspace-mcp's single-user
 * credential-store reader points at the tokens we wrote via device flow.
 * `--single-user` tells workspace-mcp to pick the first credential file in
 * that dir without requiring session routing — which is exactly our
 * server-side, one-user setup.
 */
export async function registerMcpServer(creds: Credentials): Promise<void> {
  const data = await readClaudeJson();
  const servers = (data.mcpServers as Record<string, unknown>) || {};
  servers[MCP_SERVER_ID] = {
    type: "stdio",
    command: "uvx",
    args: ["workspace-mcp", "--single-user", "--tool-tier", WORKSPACE_MCP_TOOL_TIER],
    env: {
      GOOGLE_OAUTH_CLIENT_ID: creds.clientId,
      GOOGLE_OAUTH_CLIENT_SECRET: creds.clientSecret,
      WORKSPACE_MCP_CREDENTIALS_DIR: WORKSPACE_MCP_CREDS_DIR,
      ...(creds.accountEmail ? { USER_GOOGLE_EMAIL: creds.accountEmail } : {}),
    },
  };
  data.mcpServers = servers;
  await writeClaudeJson(data);
}

/** Remove the custom Google Workspace MCP entry from ~/.claude.json. */
export async function unregisterMcpServer(): Promise<void> {
  const data = await readClaudeJson();
  const servers = data.mcpServers as Record<string, unknown> | undefined;
  if (!servers || !(MCP_SERVER_ID in servers)) return;
  delete servers[MCP_SERVER_ID];
  data.mcpServers = servers;
  await writeClaudeJson(data);
}

/** Check whether our MCP entry is registered in ~/.claude.json. */
export async function isMcpServerRegistered(): Promise<boolean> {
  const data = await readClaudeJson();
  const servers = data.mcpServers as Record<string, unknown> | undefined;
  return !!servers && MCP_SERVER_ID in servers;
}

/**
 * Rewrite the `--tool-tier` arg of an existing google-workspace-custom entry
 * so users who connected before the tier upgrade pick up the broader tool set
 * without disconnecting. Tokens (in `env`) are preserved untouched.
 *
 * Idempotent and silent: missing entry, missing flag, already-current tier,
 * or unreadable claude.json all return `{ migrated: false }` without throwing.
 * Safe to call on every server boot and every settings-page open.
 */
export async function migrateGoogleMcpTier(): Promise<{
  migrated: boolean;
  oldTier?: string;
}> {
  const data = await readClaudeJson();
  const servers = data.mcpServers as Record<string, unknown> | undefined;
  if (!servers || !(MCP_SERVER_ID in servers)) return { migrated: false };

  const entry = servers[MCP_SERVER_ID] as { args?: unknown } | undefined;
  if (!entry || !Array.isArray(entry.args)) return { migrated: false };

  const args = entry.args as unknown[];
  const flagIndex = args.indexOf("--tool-tier");
  if (flagIndex < 0 || flagIndex + 1 >= args.length) return { migrated: false };

  const current = args[flagIndex + 1];
  if (current === WORKSPACE_MCP_TOOL_TIER) return { migrated: false };

  args[flagIndex + 1] = WORKSPACE_MCP_TOOL_TIER;
  await writeClaudeJson(data);
  return { migrated: true, oldTier: typeof current === "string" ? current : undefined };
}
