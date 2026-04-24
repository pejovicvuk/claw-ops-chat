import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import {
  deleteCredentials,
  saveCredentials,
  type TrelloCredentials,
} from "@/lib/trello-custom-config";

/**
 * Save Trello API credentials. Trello auth is a key + token pair (key
 * is public, token is the user-authorized secret). We probe
 * api.trello.com/1/members/me so invalid pairs fail fast. No MCP
 * server is registered — server.ts injects TRELLO_API_KEY / TRELLO_TOKEN
 * env vars on every query so a skill or MCP can read them.
 */
async function postHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  let body: { apiKey?: unknown; apiToken?: unknown };
  try {
    body = (await request.json()) as { apiKey?: unknown; apiToken?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const apiToken = typeof body.apiToken === "string" ? body.apiToken.trim() : "";

  if (!apiKey || !apiToken) {
    return Response.json({ error: "apiKey and apiToken are both required" }, { status: 400 });
  }

  // Trello keys are 32-char hex; tokens are 64-char hex. Reject anything
  // that clearly isn't one of those to avoid saving garbage.
  if (!/^[a-f0-9]{32}$/i.test(apiKey)) {
    return Response.json(
      { error: "That doesn't look like a Trello API key (expected 32 hex chars)." },
      { status: 400 },
    );
  }
  if (!/^[a-f0-9]{64,}$/i.test(apiToken)) {
    return Response.json(
      { error: "That doesn't look like a Trello API token (expected 64+ hex chars)." },
      { status: 400 },
    );
  }

  // Probe /members/me so we fail now (not on first chat query). Note
  // Trello requires both key and token as query params — not headers.
  let username: string | null = null;
  let fullName: string | null = null;
  try {
    const url = new URL("https://api.trello.com/1/members/me");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("token", apiToken);
    const probe = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (probe.status === 401 || probe.status === 403) {
      return Response.json({ error: "Trello rejected this key/token pair." }, { status: 400 });
    }
    if (!probe.ok) {
      return Response.json(
        { error: `Trello /members/me returned ${probe.status}.` },
        { status: 400 },
      );
    }
    const data = (await probe.json()) as { username?: string; fullName?: string };
    username = data.username ?? null;
    fullName = data.fullName ?? null;
  } catch (err) {
    return Response.json(
      {
        error: `Could not reach api.trello.com: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }

  const creds: TrelloCredentials = { apiKey, apiToken, username, fullName };
  try {
    await saveCredentials(creds);
  } catch (err) {
    return Response.json(
      { error: `Failed to save credentials: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, username, fullName });
}

async function deleteHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  await deleteCredentials();
  return Response.json({ ok: true });
}

export const POST = withAudit(
  { route: "/api/trello-custom/credentials", label: "Trello credentials" },
  postHandler,
);
export const DELETE = withAudit(
  { route: "/api/trello-custom/credentials", label: "Trello credentials" },
  deleteHandler,
);
