import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import {
  deleteCredentials,
  registerMcpServer,
  saveCredentials,
  unregisterMcpServer,
  type BitbucketCredentials,
} from "@/lib/bitbucket-custom-config";

/**
 * Save Bitbucket Cloud credentials (email + API token + workspace slug)
 * and register the in-repo Bitbucket MCP wrapper in ~/.claude.json, so
 * Claude sees bitbucket_* tools on its next turn. We validate the token
 * by hitting https://api.bitbucket.org/2.0/user with basic-auth first —
 * invalid / expired tokens fail fast instead of silently landing in
 * claude.json.
 */
async function postHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  let body: { email?: unknown; apiToken?: unknown; workspace?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const apiToken = typeof body.apiToken === "string" ? body.apiToken.trim() : "";
  const workspace = typeof body.workspace === "string" ? body.workspace.trim() : "";

  if (!email || !apiToken || !workspace) {
    return Response.json(
      { error: "email, apiToken, and workspace are all required" },
      { status: 400 },
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Email doesn't look valid." }, { status: 400 });
  }

  // Probe /user with basic-auth to confirm the credentials work.
  let displayName: string | null = null;
  try {
    const auth = Buffer.from(`${email}:${apiToken}`, "utf-8").toString("base64");
    const probe = await fetch("https://api.bitbucket.org/2.0/user", {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (probe.status === 401) {
      return Response.json(
        { error: "Bitbucket rejected the email / API token pair (401)." },
        { status: 400 },
      );
    }
    if (!probe.ok) {
      return Response.json({ error: `Bitbucket /user returned ${probe.status}.` }, { status: 400 });
    }
    const data = (await probe.json()) as { display_name?: string; nickname?: string };
    displayName = data.display_name ?? data.nickname ?? null;
  } catch (err) {
    return Response.json(
      {
        error: `Could not reach api.bitbucket.org: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }

  const creds: BitbucketCredentials = { email, apiToken, workspace, displayName };
  try {
    await saveCredentials(creds);
    await registerMcpServer(creds);
  } catch (err) {
    return Response.json(
      { error: `Failed to save credentials: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, displayName });
}

async function deleteHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  await deleteCredentials();
  await unregisterMcpServer();
  return Response.json({ ok: true });
}

export const POST = withAudit(
  { route: "/api/bitbucket-custom/credentials", label: "Bitbucket credentials" },
  postHandler,
);
export const DELETE = withAudit(
  { route: "/api/bitbucket-custom/credentials", label: "Bitbucket credentials" },
  deleteHandler,
);
