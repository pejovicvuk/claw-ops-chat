import { extractSession, unauthorized } from "@/lib/auth-server";
import { DEFAULT_SAFE_TOOLS, loadToolCatalog } from "@/lib/reports/tool-catalog";

/**
 * Tool + MCP server catalog used by the New Job form.
 *
 * The MCP server list is derived fresh on every request from ~/.claude.json
 * so changes made via Settings → Connections show up without restarting
 * the server.
 */
export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();
  const catalog = loadToolCatalog();
  return Response.json({
    builtins: catalog.builtins,
    mcpServers: catalog.mcpServers,
    defaults: DEFAULT_SAFE_TOOLS,
  });
}
