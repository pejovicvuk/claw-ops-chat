import { extractSession, unauthorized } from "@/lib/auth-server";
import { deleteCredentials, unregisterMcpServer } from "@/lib/google-custom-config";

/**
 * Disconnect the custom Google Workspace integration.
 * Removes the MCP server entry from ~/.claude.json and deletes stored credentials.
 * (workspace-mcp's own token file is left to the user to clean up — it lives
 * under its own config dir.)
 */
export async function POST(request: Request) {
  if (!extractSession(request)) return unauthorized();

  try {
    await unregisterMcpServer();
    await deleteCredentials();
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to disconnect" },
      { status: 500 },
    );
  }
}
