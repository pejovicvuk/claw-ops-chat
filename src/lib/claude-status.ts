import { existsSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";

export interface ClaudeInfo {
  available: boolean;
  version?: string;
  path?: string;
  error?: string;
}

/**
 * Detect whether Claude Code CLI is installed and usable.
 * Tries system-installed `claude` first (user-managed, always up to date),
 * then falls back to the bundled SDK cli.js.
 */
/**
 * Normalize path to forward slashes.
 * Node.js spawn() on Windows mangles backslash paths (treats them as escapes).
 * Forward slashes work correctly on all platforms.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

export function detectClaude(): ClaudeInfo {
  // 1. Try system-installed claude (preferred)
  try {
    const cmd = process.platform === "win32" ? "where claude" : "which claude";
    const systemPath = execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim().split("\n")[0];
    if (systemPath && existsSync(systemPath)) {
      const version = getVersion(systemPath);
      if (version) {
        return { available: true, version, path: normalizePath(systemPath) };
      }
    }
  } catch {
    // not installed system-wide
  }

  // 2. Try bundled SDK cli.js
  try {
    const sdkMain = require.resolve("@anthropic-ai/claude-agent-sdk");
    const sdkCli = join(dirname(sdkMain), "cli.js");
    if (existsSync(sdkCli)) {
      const version = getVersion(sdkCli);
      if (version) {
        return { available: true, version, path: normalizePath(sdkCli) };
      }
    }
  } catch {
    // SDK not installed
  }

  return { available: false, error: "Claude Code CLI is not installed" };
}

/** Run the executable with --version and return the output. */
function getVersion(executablePath: string): string | null {
  try {
    const normalized = normalizePath(executablePath);
    const cmd = normalized.endsWith(".js")
      ? `node "${normalized}" --version`
      : `"${normalized}" --version`;
    return execSync(cmd, { encoding: "utf-8", timeout: 10000 }).trim() || null;
  } catch {
    return null;
  }
}
