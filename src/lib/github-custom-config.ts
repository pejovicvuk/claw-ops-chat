import { existsSync } from "fs";
import { mkdir, readFile, writeFile, chmod, unlink } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { spawn } from "child_process";
import {
  registerMcpServer as registerServer,
  unregisterMcpServer as unregisterServer,
  isMcpServerRegistered as isServerRegistered,
} from "./mcp-register";

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

/**
 * Register the GitHub MCP server in ~/.claude.json. We use the TypeScript
 * reference server (`@modelcontextprotocol/server-github`) because it's
 * on npm and npx will download it on first use — no extra install step.
 */
export async function registerMcpServer(creds: GitHubCredentials): Promise<void> {
  await registerServer(MCP_SERVER_ID, {
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN: creds.token,
    },
  });
}

export async function unregisterMcpServer(): Promise<void> {
  await unregisterServer(MCP_SERVER_ID);
}

export async function isMcpServerRegistered(): Promise<boolean> {
  return isServerRegistered(MCP_SERVER_ID);
}

/**
 * Authenticate the gh CLI with the stored PAT so that tools like
 * claw-ops-fe (which checks `gh auth status` via SSH) see GitHub as
 * connected. Reads the token from stdin to avoid exposing it in argv.
 * Best-effort — silently no-ops if gh is not installed.
 */
export async function syncGhCli(token: string): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn("gh", ["auth", "login", "--with-token"], { timeout: 15000 });
    proc.stdin.write(token + "\n");
    proc.stdin.end();
    proc.on("close", () => resolve());
    proc.on("error", () => resolve());
  });
}

/**
 * Log out of the gh CLI when GitHub is disconnected in claw-ops-chat.
 * Best-effort — silently no-ops if gh is not installed or not logged in.
 */
export async function unsyncGhCli(): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn("gh", ["auth", "logout", "--hostname", "github.com", "--yes"], {
      timeout: 10000,
    });
    proc.on("close", () => resolve());
    proc.on("error", () => resolve());
  });
}
