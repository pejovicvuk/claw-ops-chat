import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import {
  deleteCredentials,
  loadCredentials,
  registerMcpServer,
  saveCredentials,
  unregisterMcpServer,
  type MicrosoftCredentials,
} from "@/lib/microsoft-custom-config";

async function postHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  let body: { clientId?: unknown; tenantId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";

  if (!clientId) return Response.json({ error: "clientId is required" }, { status: 400 });
  if (!tenantId) return Response.json({ error: "tenantId is required" }, { status: 400 });

  // Preserve tokens and account info from an existing record so that
  // re-entering credentials (e.g. correcting a typo in the tenant ID)
  // does not invalidate an active session. If the clientId has actually
  // changed, the next status refresh will detect an invalid_grant and
  // surface tokenExpired=true, prompting the user to re-authorize.
  const existing = await loadCredentials();
  const merged: MicrosoftCredentials = {
    clientId,
    tenantId,
    ...(existing?.accessToken ? { accessToken: existing.accessToken } : {}),
    ...(existing?.refreshToken ? { refreshToken: existing.refreshToken } : {}),
    ...(existing?.expiresAt ? { expiresAt: existing.expiresAt } : {}),
    ...(existing?.accountEmail ? { accountEmail: existing.accountEmail } : {}),
    ...(existing?.displayName ? { displayName: existing.displayName } : {}),
  };

  try {
    await saveCredentials(merged);
    // Re-register the MCP server only when a token is already present so
    // the env block stays consistent with the saved credentials.
    if (merged.accessToken) {
      await registerMcpServer(merged);
    }
  } catch (err) {
    return Response.json(
      {
        error: `Failed to save credentials: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }

  return Response.json({ ok: true });
}

async function deleteHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  await unregisterMcpServer();
  await deleteCredentials();
  return Response.json({ ok: true });
}

export const POST = withAudit(
  { route: "/api/microsoft-custom/credentials", label: "Microsoft 365 credentials" },
  postHandler,
);
export const DELETE = withAudit(
  { route: "/api/microsoft-custom/credentials", label: "Microsoft 365 credentials" },
  deleteHandler,
);
