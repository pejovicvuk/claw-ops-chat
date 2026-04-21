import { extractSession, unauthorized } from "@/lib/auth-server";
import {
  NOTION_API_VERSION,
  deleteCredentials,
  registerMcpServer,
  saveCredentials,
  unregisterMcpServer,
  type NotionCredentials,
} from "@/lib/notion-custom-config";

/**
 * Save a Notion Internal Integration Token + register the official Notion
 * MCP server. Probe api.notion.com/v1/users/me with the token so bad or
 * not-yet-shared integrations fail fast instead of silently landing in
 * claude.json.
 */
export async function POST(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  let body: { token?: unknown };
  try {
    body = (await request.json()) as { token?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) {
    return Response.json({ error: "token is required" }, { status: 400 });
  }
  // Notion integration tokens are prefixed "secret_" (classic) or
  // "ntn_" (new format rolled out 2024). Reject anything else — saves a
  // round-trip and stops accidental paste of an OAuth access token.
  if (!token.startsWith("secret_") && !token.startsWith("ntn_")) {
    return Response.json(
      {
        error:
          "That doesn't look like a Notion integration token. Expected it to start with secret_ or ntn_.",
      },
      { status: 400 },
    );
  }

  // Probe /v1/users/me so we fail now (not on first chat query).
  let workspaceName: string | null = null;
  let botName: string | null = null;
  try {
    const probe = await fetch("https://api.notion.com/v1/users/me", {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_API_VERSION,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (probe.status === 401) {
      return Response.json({ error: "Notion rejected this token (401)." }, { status: 400 });
    }
    if (!probe.ok) {
      return Response.json({ error: `Notion /users/me returned ${probe.status}.` }, { status: 400 });
    }
    const data = (await probe.json()) as {
      name?: string;
      bot?: { workspace_name?: string };
    };
    botName = data.name ?? null;
    workspaceName = data.bot?.workspace_name ?? null;
  } catch (err) {
    return Response.json(
      {
        error: `Could not reach api.notion.com: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }

  const creds: NotionCredentials = { token, workspaceName, botName };
  try {
    await saveCredentials(creds);
    await registerMcpServer(creds);
  } catch (err) {
    return Response.json(
      { error: `Failed to save credentials: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, workspaceName, botName });
}

export async function DELETE(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  await deleteCredentials();
  await unregisterMcpServer();
  return Response.json({ ok: true });
}
