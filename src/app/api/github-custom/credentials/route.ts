import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import {
  deleteCredentials,
  registerMcpServer,
  saveCredentials,
  syncGhCli,
  unsyncGhCli,
  unregisterMcpServer,
  type GitHubCredentials,
} from "@/lib/github-custom-config";

/**
 * Save a GitHub personal access token + register the MCP server in one
 * atomic-ish step. We probe https://api.github.com/user with the token
 * first so invalid / expired PATs fail fast instead of silently landing
 * in claude.json.
 */
async function postHandler(request: Request): Promise<Response> {
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
  // GitHub PATs: classic tokens start with ghp_, fine-grained with
  // github_pat_, and some legacy tokens are 40 hex chars. Reject anything
  // that clearly isn't one of those to avoid saving garbage.
  if (
    !token.startsWith("ghp_") &&
    !token.startsWith("github_pat_") &&
    !/^[a-f0-9]{40}$/i.test(token)
  ) {
    return Response.json(
      {
        error:
          "That doesn't look like a GitHub token. Expected it to start with ghp_ or github_pat_.",
      },
      { status: 400 },
    );
  }

  // Probe /user so we fail now (not on first chat query).
  let login: string | null = null;
  try {
    const probe = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "claw-ops-chat",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (probe.status === 401) {
      return Response.json({ error: "GitHub rejected this token (401)." }, { status: 400 });
    }
    if (!probe.ok) {
      return Response.json({ error: `GitHub /user returned ${probe.status}.` }, { status: 400 });
    }
    const data = (await probe.json()) as { login?: string };
    login = data.login ?? null;
  } catch (err) {
    return Response.json(
      {
        error: `Could not reach api.github.com: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }

  const creds: GitHubCredentials = { token, login };
  try {
    await saveCredentials(creds);
    await registerMcpServer(creds);
    void syncGhCli(token);
  } catch (err) {
    return Response.json(
      { error: `Failed to save credentials: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, login });
}

async function deleteHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  await deleteCredentials();
  await unregisterMcpServer();
  void unsyncGhCli();
  return Response.json({ ok: true });
}

export const POST = withAudit(
  { route: "/api/github-custom/credentials", label: "GitHub credentials" },
  postHandler,
);
export const DELETE = withAudit(
  { route: "/api/github-custom/credentials", label: "GitHub credentials" },
  deleteHandler,
);
