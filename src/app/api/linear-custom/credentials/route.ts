import { extractSession, unauthorized } from "@/lib/auth-server";
import {
  deleteCredentials,
  registerMcpServer,
  saveCredentials,
  unregisterMcpServer,
  type LinearCredentials,
} from "@/lib/linear-custom-config";

/**
 * Save a Linear API key + register the Linear MCP server. We probe the
 * Linear GraphQL API with the key first so invalid keys fail fast
 * instead of silently landing in claude.json.
 */
export async function POST(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  let body: { apiKey?: unknown };
  try {
    body = (await request.json()) as { apiKey?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) {
    return Response.json({ error: "apiKey is required" }, { status: 400 });
  }
  // Linear personal API keys start with "lin_api_". Reject anything that
  // clearly doesn't look like one — saves a round-trip and catches
  // accidental paste of e.g. an OAuth access token.
  if (!apiKey.startsWith("lin_api_")) {
    return Response.json(
      { error: "That doesn't look like a Linear API key. Expected it to start with lin_api_." },
      { status: 400 },
    );
  }

  // Probe the `viewer` query so we fail now (not on first chat query).
  let email: string | null = null;
  let name: string | null = null;
  try {
    const probe = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "{ viewer { id email name } }" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (probe.status === 401 || probe.status === 400) {
      return Response.json({ error: "Linear rejected this key." }, { status: 400 });
    }
    if (!probe.ok) {
      return Response.json(
        { error: `Linear returned ${probe.status}.` },
        { status: 400 },
      );
    }
    const data = (await probe.json()) as {
      data?: { viewer?: { email?: string; name?: string } };
      errors?: unknown;
    };
    if (data.errors) {
      return Response.json({ error: "Linear rejected this key." }, { status: 400 });
    }
    email = data.data?.viewer?.email ?? null;
    name = data.data?.viewer?.name ?? null;
  } catch (err) {
    return Response.json(
      {
        error: `Could not reach api.linear.app: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }

  const creds: LinearCredentials = { apiKey, email, name };
  try {
    await saveCredentials(creds);
    await registerMcpServer(creds);
  } catch (err) {
    return Response.json(
      { error: `Failed to save credentials: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, email, name });
}

export async function DELETE(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  await deleteCredentials();
  await unregisterMcpServer();
  return Response.json({ ok: true });
}
