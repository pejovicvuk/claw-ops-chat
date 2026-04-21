import { extractSession, unauthorized } from "@/lib/auth-server";
import {
  deleteCredentials,
  normaliseDomain,
  saveCredentials,
  type JiraCredentials,
} from "@/lib/jira-custom-config";

/**
 * Save Jira Cloud credentials. We probe <domain>/rest/api/3/myself with
 * basic-auth so bad tokens fail fast instead of silently landing on
 * disk. No MCP server is registered — server.ts injects the three env
 * vars on every query so a skill or MCP can read them.
 */
export async function POST(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  let body: { domain?: unknown; email?: unknown; apiToken?: unknown };
  try {
    body = (await request.json()) as {
      domain?: unknown;
      email?: unknown;
      apiToken?: unknown;
    };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const domain =
    typeof body.domain === "string" ? normaliseDomain(body.domain) : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const apiToken = typeof body.apiToken === "string" ? body.apiToken.trim() : "";

  if (!domain || !email || !apiToken) {
    return Response.json(
      { error: "domain, email, and apiToken are all required" },
      { status: 400 },
    );
  }
  if (!/^[\w.-]+\.atlassian\.net$/i.test(domain)) {
    return Response.json(
      {
        error:
          "Domain must be a *.atlassian.net host (e.g. mycompany.atlassian.net). Self-hosted Jira isn't supported.",
      },
      { status: 400 },
    );
  }

  // Basic auth probe: email + API token. Bitbucket uses the same scheme
  // so the error surface is familiar.
  let displayName: string | null = null;
  try {
    const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
    const probe = await fetch(`https://${domain}/rest/api/3/myself`, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (probe.status === 401 || probe.status === 403) {
      return Response.json({ error: "Jira rejected this token (401/403)." }, { status: 400 });
    }
    if (!probe.ok) {
      return Response.json({ error: `Jira returned ${probe.status}.` }, { status: 400 });
    }
    const data = (await probe.json()) as { displayName?: string };
    displayName = data.displayName ?? null;
  } catch (err) {
    return Response.json(
      {
        error: `Could not reach ${domain}: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }

  const creds: JiraCredentials = { domain, email, apiToken, displayName };
  try {
    await saveCredentials(creds);
  } catch (err) {
    return Response.json(
      { error: `Failed to save credentials: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, displayName, domain });
}

export async function DELETE(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  await deleteCredentials();
  return Response.json({ ok: true });
}
