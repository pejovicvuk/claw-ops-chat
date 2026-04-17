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
 */

export const MCP_SERVER_ID = "google-workspace-custom";

const CREDENTIALS_DIR = join(homedir(), ".claude", "custom-google-workspace");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");
const CLAUDE_JSON = join(homedir(), ".claude.json");

interface Credentials {
  clientId: string;
  clientSecret: string;
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

/** Add or overwrite the custom Google Workspace MCP entry in ~/.claude.json. */
export async function registerMcpServer(creds: Credentials): Promise<void> {
  const data = await readClaudeJson();
  const servers = (data.mcpServers as Record<string, unknown>) || {};
  servers[MCP_SERVER_ID] = {
    type: "stdio",
    command: "uvx",
    args: ["workspace-mcp", "--tool-tier", "core"],
    env: {
      GOOGLE_OAUTH_CLIENT_ID: creds.clientId,
      GOOGLE_OAUTH_CLIENT_SECRET: creds.clientSecret,
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
