import { existsSync, readFileSync } from "fs";
import { mkdir, readFile, writeFile, chmod, unlink } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import {
  registerMcpServer as registerServer,
  unregisterMcpServer as unregisterServer,
  isMcpServerRegistered as isServerRegistered,
} from "./mcp-register";

/**
 * Stores Bitbucket Cloud credentials and registers the in-repo Bitbucket
 * MCP wrapper (src/bitbucket-mcp.ts → /app/bitbucket-mcp.js) in
 * ~/.claude.json, so the Claude Agent SDK spawns it on demand and Claude
 * sees bitbucket_* tools — same pattern as GitHub / Notion / Google.
 *
 * The MCP wrapper shells out to /opt/skills/bitbucket/bitbucket-cli.sh
 * (docker-compose mount) using the env vars we embed in the registration.
 *
 * Credentials file: ~/.claude/custom-bitbucket/credentials.json (mode 0600)
 * MCP server ID:    "bitbucket"
 */

export const MCP_SERVER_ID = "bitbucket";

const CREDENTIALS_DIR = join(homedir(), ".claude", "custom-bitbucket");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");

const MCP_SCRIPT = process.env.BITBUCKET_MCP_SCRIPT ?? "/app/bitbucket-mcp.js";
const CLI_PATH = process.env.BITBUCKET_CLI ?? "/opt/skills/bitbucket/bitbucket-cli.sh";

export interface BitbucketCredentials {
  email: string;
  apiToken: string;
  workspace: string;
  /** Display name from the validation probe — purely for UI. */
  displayName?: string | null;
}

/** Save credentials to disk (mode 0600). */
export async function saveCredentials(creds: BitbucketCredentials): Promise<void> {
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  await writeFile(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), "utf-8");
  try {
    await chmod(CREDENTIALS_FILE, 0o600);
  } catch {
    /* ignore — non-POSIX or already correct */
  }
}

/** Async load, used by API routes. */
export async function loadCredentials(): Promise<BitbucketCredentials | null> {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  try {
    const raw = await readFile(CREDENTIALS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as BitbucketCredentials;
    if (!parsed.email || !parsed.apiToken || !parsed.workspace) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Synchronous load for the hot path inside server.ts's chat-turn env
 * builder. Mirrors the jira/trello pattern — we can't await inside the
 * env-computation closure without restructuring handleUserMessage, and
 * the file is small + local-disk so a sync read is imperceptible.
 */
export function loadCredentialsSync(): BitbucketCredentials | null {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  try {
    const raw = readFileSync(CREDENTIALS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as BitbucketCredentials;
    if (!parsed.email || !parsed.apiToken || !parsed.workspace) return null;
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

/**
 * Register the Bitbucket MCP server in ~/.claude.json. The env block is
 * what the wrapper (and, transitively, bitbucket-cli.sh) reads — the chat
 * server itself no longer injects BITBUCKET_* vars into the SDK child.
 */
export async function registerMcpServer(creds: BitbucketCredentials): Promise<void> {
  await registerServer(MCP_SERVER_ID, {
    type: "stdio",
    command: "node",
    args: [MCP_SCRIPT],
    env: {
      ATLASSIAN_EMAIL: creds.email,
      BITBUCKET_API_TOKEN: creds.apiToken,
      BITBUCKET_WORKSPACE: creds.workspace,
      BITBUCKET_CLI: CLI_PATH,
    },
  });
}

export async function unregisterMcpServer(): Promise<void> {
  await unregisterServer(MCP_SERVER_ID);
}

export async function isMcpServerRegistered(): Promise<boolean> {
  return isServerRegistered(MCP_SERVER_ID);
}
