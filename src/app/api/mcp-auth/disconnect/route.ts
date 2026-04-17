import { spawn } from "child_process";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { findKnownServerById } from "@/app/api/mcp-status/route";
import type { McpAuthServiceId } from "@/lib/mcp-auth-sessions";

/** Run `claude mcp remove <cliName>` with a short timeout. */
function runMcpRemove(cliName: string): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("claude", ["mcp", "remove", cliName], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, stderr });
    });
    child.on("error", (err) => {
      resolve({ ok: false, stderr: err.message });
    });
    setTimeout(() => {
      if (!child.killed) child.kill();
      resolve({ ok: false, stderr: "timeout" });
    }, 15_000);
  });
}

/**
 * Remove a previously-added hosted MCP connector. Spawns
 * `claude mcp remove <cliName>` for the selected service.
 */
export async function POST(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as { id?: string };
  const id = body.id;
  if (id !== "gmail" && id !== "google-drive" && id !== "google-calendar") {
    return Response.json({ error: "Invalid service id" }, { status: 400 });
  }
  const serviceId: McpAuthServiceId = id;

  const known = findKnownServerById(serviceId);
  if (!known) {
    return Response.json({ error: "Unknown service" }, { status: 400 });
  }

  const result = await runMcpRemove(known.cliName);
  if (!result.ok) {
    return Response.json({ error: result.stderr || "remove failed" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
