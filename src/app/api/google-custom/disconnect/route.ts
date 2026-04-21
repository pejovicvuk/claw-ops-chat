import { extractSession, unauthorized } from "@/lib/auth-server";
import { deleteCredentials, unregisterMcpServer } from "@/lib/google-custom-config";
import { deleteWorkspaceMcpCredentials } from "@/lib/google-workspace-mcp-tokens";

/**
 * Disconnect the custom Google Workspace integration.
 * Removes the MCP server entry from ~/.claude.json, deletes our stored
 * OAuth client credentials, and wipes any workspace-mcp credential files
 * we wrote for the device flow.
 */
export async function POST(request: Request) {
  if (!extractSession(request)) return unauthorized();

  try {
    await unregisterMcpServer();
    await deleteCredentials();
    await deleteWorkspaceMcpCredentials();
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to disconnect" },
      { status: 500 },
    );
  }
}
