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
 * Stores a Linear API key and registers a Linear MCP server in
 * ~/.claude.json so Claude can call the Linear API directly.
 *
 * Credentials file: ~/.claude/custom-linear/credentials.json (mode 0600)
 * MCP server ID:    "linear"
 */

export const MCP_SERVER_ID = "linear";

const CREDENTIALS_DIR = join(homedir(), ".claude", "custom-linear");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");

export interface LinearCredentials {
  apiKey: string;
  /** Display fields captured from the validation probe — UI only. */
  email?: string | null;
  name?: string | null;
}

export async function saveCredentials(creds: LinearCredentials): Promise<void> {
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  await writeFile(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), "utf-8");
  try {
    await chmod(CREDENTIALS_FILE, 0o600);
  } catch {
    /* non-POSIX */
  }
}

export async function loadCredentials(): Promise<LinearCredentials | null> {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  try {
    const raw = await readFile(CREDENTIALS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as LinearCredentials;
    if (!parsed.apiKey) return null;
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
 * Register the Linear MCP server in ~/.claude.json. Uses the community
 * `@tacticlaunch/mcp-linear` server, fetched by npx on first use. Users
 * who prefer a different Linear MCP can swap the `command`/`args` in
 * claude.json after registration — this module only seeds the defaults.
 */
export async function registerMcpServer(creds: LinearCredentials): Promise<void> {
  await registerServer(MCP_SERVER_ID, {
    type: "stdio",
    command: "npx",
    args: ["-y", "@tacticlaunch/mcp-linear"],
    env: {
      LINEAR_API_KEY: creds.apiKey,
    },
  });
}

export async function unregisterMcpServer(): Promise<void> {
  await unregisterServer(MCP_SERVER_ID);
}

export async function isMcpServerRegistered(): Promise<boolean> {
  return isServerRegistered(MCP_SERVER_ID);
}
