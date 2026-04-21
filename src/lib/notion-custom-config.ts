import { existsSync } from "fs";
import { mkdir, readFile, writeFile, chmod, unlink } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import {
  registerMcpServer as registerServer,
  unregisterMcpServer as unregisterServer,
  isMcpServerRegistered as isServerRegistered,
} from "./mcp-register";

/**
 * Stores a Notion Internal Integration Token and registers the official
 * Notion MCP server in ~/.claude.json so Claude can search, read, and
 * update pages / databases that the integration is shared with.
 *
 * Credentials file: ~/.claude/custom-notion/credentials.json (mode 0600)
 * MCP server ID:    "notion"
 */

export const MCP_SERVER_ID = "notion";
/** Notion API version header the official MCP server sends. Pin it here
 * so a future Notion migration is a one-line change. */
export const NOTION_API_VERSION = "2022-06-28";

const CREDENTIALS_DIR = join(homedir(), ".claude", "custom-notion");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");

export interface NotionCredentials {
  token: string;
  /** Display fields captured from the validation probe — UI only. */
  workspaceName?: string | null;
  botName?: string | null;
}

export async function saveCredentials(creds: NotionCredentials): Promise<void> {
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  await writeFile(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), "utf-8");
  try {
    await chmod(CREDENTIALS_FILE, 0o600);
  } catch {
    /* non-POSIX */
  }
}

export async function loadCredentials(): Promise<NotionCredentials | null> {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  try {
    const raw = await readFile(CREDENTIALS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as NotionCredentials;
    if (!parsed.token) return null;
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

/**
 * Register the Notion MCP server in ~/.claude.json. Uses the official
 * @notionhq/notion-mcp-server, which authenticates via the
 * OPENAPI_MCP_HEADERS env var (a JSON blob containing the Authorization
 * + Notion-Version headers — that's the contract defined by the
 * server itself, not something we invented).
 */
export async function registerMcpServer(creds: NotionCredentials): Promise<void> {
  const headers = JSON.stringify({
    Authorization: `Bearer ${creds.token}`,
    "Notion-Version": NOTION_API_VERSION,
  });
  await registerServer(MCP_SERVER_ID, {
    type: "stdio",
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server"],
    env: {
      OPENAPI_MCP_HEADERS: headers,
    },
  });
}

export async function unregisterMcpServer(): Promise<void> {
  await unregisterServer(MCP_SERVER_ID);
}

export async function isMcpServerRegistered(): Promise<boolean> {
  return isServerRegistered(MCP_SERVER_ID);
}
