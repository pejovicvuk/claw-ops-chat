import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { homedir } from "os";

/**
 * Shared helper for managing MCP server entries in `~/.claude.json`.
 *
 * Every settings page that connects to a service with its own MCP server
 * (GitHub, Linear, Notion, Asana, Discord, …) needs the same three
 * operations: upsert an `mcpServers[<id>]` block, remove it, or check
 * whether it's there. Historically this was copy-pasted per integration
 * (see the original `github-custom-config.ts`) — this module centralises
 * it so every new integration is ~3 lines of wiring instead of ~30.
 *
 * Concurrency note: the read-modify-write on `~/.claude.json` is not
 * locked. In a single-user app with one active settings page at a time
 * this is fine; if concurrent writes become a real risk, swap in a file
 * lock (e.g. `proper-lockfile`) without changing this module's surface.
 */

const CLAUDE_JSON = join(homedir(), ".claude.json");

export interface StdioMcpServer {
  type: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface HttpMcpServer {
  type: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerDefinition = StdioMcpServer | HttpMcpServer;

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
    // Corrupt or unreadable — treat as empty so a save can still succeed.
    // We intentionally do NOT throw: a bad claude.json should not brick
    // the settings UI, and the next write will reconstruct a valid file.
    return {};
  }
}

async function writeClaudeJson(data: ClaudeJson): Promise<void> {
  await mkdir(dirname(CLAUDE_JSON), { recursive: true });
  await writeFile(CLAUDE_JSON, JSON.stringify(data, null, 2), "utf-8");
}

/** Insert or replace the MCP server block with the given id. */
export async function registerMcpServer(
  id: string,
  definition: McpServerDefinition,
): Promise<void> {
  const data = await readClaudeJson();
  const servers = (data.mcpServers as Record<string, unknown>) || {};
  servers[id] = definition;
  data.mcpServers = servers;
  await writeClaudeJson(data);
}

/** Remove the MCP server with the given id. No-op if it isn't registered. */
export async function unregisterMcpServer(id: string): Promise<void> {
  const data = await readClaudeJson();
  const servers = data.mcpServers as Record<string, unknown> | undefined;
  if (!servers || !(id in servers)) return;
  delete servers[id];
  data.mcpServers = servers;
  await writeClaudeJson(data);
}

/** True iff the MCP server with the given id is present in claude.json. */
export async function isMcpServerRegistered(id: string): Promise<boolean> {
  const data = await readClaudeJson();
  const servers = data.mcpServers as Record<string, unknown> | undefined;
  return !!servers && id in servers;
}

/**
 * Read back the stored definition for the given id, or null if absent.
 * Useful for settings pages that want to display current env values
 * (redacted) without re-asking the user.
 */
export async function readMcpServer(id: string): Promise<McpServerDefinition | null> {
  const data = await readClaudeJson();
  const servers = data.mcpServers as Record<string, McpServerDefinition> | undefined;
  if (!servers || !(id in servers)) return null;
  return servers[id];
}
