import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

/**
 * Known Claude Code built-in tools. The autonomous runner uses this list to
 * validate that every allowedTools entry is real (catches typos like
 * "Readd" at job-save time rather than at run time).
 *
 * This list mirrors what the SDK actually exposes; keep in sync as the SDK
 * evolves. Unknown tool names are rejected by job-validator.
 */
export const BUILTIN_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",
  "WebSearch",
  "WebFetch",
  "TodoWrite",
  "NotebookEdit",
  "Agent",
  "AskUserQuestion",
  "ExitPlanMode",
  "TaskCreate",
  "TaskUpdate",
  "TaskGet",
  "TaskList",
  "TaskOutput",
  "TaskStop",
  "ScheduleWakeup",
  "ToolSearch",
  "Skill",
] as const;

/** Tools a cron run should NEVER be allowed to call (would block waiting for a human). */
export const HUMAN_REQUIRED_TOOLS = new Set<string>(["AskUserQuestion", "ExitPlanMode"]);

/** Default "safe" selection prepopulated in the New Job form. */
export const DEFAULT_SAFE_TOOLS = ["Read", "Glob", "Grep", "Write", "WebSearch", "WebFetch"];

export interface ToolCatalog {
  builtins: string[];
  mcpServers: Array<{ name: string; tools: string[] }>;
}

/**
 * Build a catalog of every tool Claude might call in this installation.
 *
 * MCP server names come from ~/.claude.json (same source as server.ts
 * line ~107). The actual tool names exposed by each server aren't known
 * statically — MCP tools appear as `mcp__<server>__<tool>` at runtime. We
 * surface the server names and let the user allowlist a wildcard
 * `mcp__<server>__*` which the canUseTool policy understands.
 */
export function loadToolCatalog(): ToolCatalog {
  let mcpServers: Array<{ name: string; tools: string[] }> = [];
  try {
    const raw = readFileSync(join(homedir(), ".claude.json"), "utf-8");
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    if (parsed.mcpServers && typeof parsed.mcpServers === "object") {
      mcpServers = Object.keys(parsed.mcpServers).map((name) => ({
        name,
        tools: [`mcp__${name}__*`],
      }));
    }
  } catch {
    // No ~/.claude.json — return just builtins.
  }

  return {
    builtins: [...BUILTIN_TOOLS],
    mcpServers,
  };
}

/**
 * Returns true if `toolName` is an allowed tool according to the job's
 * `allowedTools` list. Supports the `mcp__<server>__*` wildcard for MCP
 * tools so users don't have to enumerate every tool a server exposes.
 */
export function isToolAllowed(toolName: string, allowed: string[]): boolean {
  if (allowed.includes(toolName)) return true;
  for (const pattern of allowed) {
    if (pattern.endsWith("*") && toolName.startsWith(pattern.slice(0, -1))) {
      return true;
    }
  }
  return false;
}
