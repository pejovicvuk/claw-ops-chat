import { spawn } from "child_process";
import { extractSession, unauthorized } from "@/lib/auth-server";

export type McpServerStatus = "connected" | "needs-auth" | "error";

export interface McpServerInfo {
  id: string;
  name: string;
  url: string | null;
  status: McpServerStatus;
}

/**
 * Known Claude.ai hosted connectors we care about.
 * Keys are the exact names that appear in `claude mcp list` output
 * after the `claude.ai ` prefix.
 */
const KNOWN_SERVERS: Record<string, { id: string }> = {
  Gmail: { id: "gmail" },
  "Google Drive": { id: "google-drive" },
  "Google Calendar": { id: "google-calendar" },
  "Microsoft 365": { id: "microsoft-365" },
};

/** Run `claude mcp list` with a short timeout and return stdout. */
function runMcpList(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["mcp", "list"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code === 0 || stdout) resolve(stdout);
      else reject(new Error(stderr || `exit ${code}`));
    });
    child.on("error", (err) => reject(err));
    setTimeout(() => {
      if (!child.killed) child.kill();
      reject(new Error("timeout"));
    }, 15_000);
  });
}

/**
 * Parse `claude mcp list` output. Each server line looks like:
 *   claude.ai Gmail: https://gmail.mcp.claude.com/mcp - ! Needs authentication
 *   claude.ai Google Drive: https://drivemcp.googleapis.com/mcp/v1 - ✓ Connected
 */
function parseMcpList(output: string): McpServerInfo[] {
  const results: McpServerInfo[] = [];

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("claude.ai ")) continue;

    // Remove prefix
    const rest = line.slice("claude.ai ".length);

    // Split on the first ": " — rest becomes "Name: url - status"
    const colonIdx = rest.indexOf(": ");
    if (colonIdx === -1) continue;

    const name = rest.slice(0, colonIdx).trim();
    const tail = rest.slice(colonIdx + 2);

    // Split on " - " to separate url from status suffix
    const dashIdx = tail.lastIndexOf(" - ");
    const url = (dashIdx === -1 ? tail : tail.slice(0, dashIdx)).trim();
    const suffix = dashIdx === -1 ? "" : tail.slice(dashIdx + 3).trim();

    let status: McpServerStatus;
    if (/needs authentication/i.test(suffix)) status = "needs-auth";
    else if (/connected|authenticated|ready|healthy/i.test(suffix) || suffix === "") {
      status = "connected";
    } else status = "error";

    const known = KNOWN_SERVERS[name];
    results.push({
      id: known?.id ?? name.toLowerCase().replace(/\s+/g, "-"),
      name,
      url: url || null,
      status,
    });
  }

  return results;
}

export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();

  try {
    const output = await runMcpList();
    const servers = parseMcpList(output);
    return Response.json({ servers });
  } catch {
    return Response.json({ servers: [] });
  }
}
