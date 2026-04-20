import { existsSync } from "fs";
import { mkdir, readFile, writeFile, chmod, unlink } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";

/**
 * Stores a GitHub personal access token and registers the official
 * Model Context Protocol GitHub server in ~/.claude.json so Claude can
 * immediately call repo/issue/PR tools.
 *
 * Credentials file: ~/.claude/custom-github/credentials.json (mode 0600)
 * MCP server ID:    "github"
 */

export const MCP_SERVER_ID = "github";

const CREDENTIALS_DIR = join(homedir(), ".claude", "custom-github");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");
const CLAUDE_JSON = join(homedir(), ".claude.json");

export interface GitHubCredentials {
  token: string;
  /** Display login captured from the validation probe — purely for UI. */
  login?: string | null;
}

/** Save the PAT to disk (mode 0600, best-effort on non-POSIX). */
export async function saveCredentials(creds: GitHubCredentials): Promise<void> {
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  await writeFile(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), "utf-8");
  try {
    await chmod(CREDENTIALS_FILE, 0o600);
  } catch {
    /* ignore — non-POSIX or already correct */
  }
}

/** Load stored credentials, or null if not configured. */
export async function loadCredentials(): Promise<GitHubCredentials | null> {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  try {
    const raw = await readFile(CREDENTIALS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as GitHubCredentials;
    if (!parsed.token) return null;
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

async function readClaudeJson(): Promise<ClaudeJson> {
  if (!existsSync(CLAUDE_JSON)) return {};
  try {
    const raw = await readFile(CLAUDE_JSON, "utf-8");
    return JSON.parse(raw) as ClaudeJson;
  } catch {
    return {};
  }
}

async function writeClaudeJson(data: ClaudeJson): Promise<void> {
  await mkdir(dirname(CLAUDE_JSON), { recursive: true });
  await writeFile(CLAUDE_JSON, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Register the GitHub MCP server in ~/.claude.json. We use the TypeScript
 * reference server (`@modelcontextprotocol/server-github`) because it's
 * on npm and npx will download it on first use — no extra install step.
 */
export async function registerMcpServer(creds: GitHubCredentials): Promise<void> {
  const data = await readClaudeJson();
  const servers = (data.mcpServers as Record<string, unknown>) || {};
  servers[MCP_SERVER_ID] = {
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN: creds.token,
    },
  };
  data.mcpServers = servers;
  await writeClaudeJson(data);
}

export async function unregisterMcpServer(): Promise<void> {
  const data = await readClaudeJson();
  const servers = data.mcpServers as Record<string, unknown> | undefined;
  if (!servers || !(MCP_SERVER_ID in servers)) return;
  delete servers[MCP_SERVER_ID];
  data.mcpServers = servers;
  await writeClaudeJson(data);
}

export async function isMcpServerRegistered(): Promise<boolean> {
  const data = await readClaudeJson();
  const servers = data.mcpServers as Record<string, unknown> | undefined;
  return !!servers && MCP_SERVER_ID in servers;
}
