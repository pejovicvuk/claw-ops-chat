import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { loadCredentials } from "@/lib/bitbucket-custom-config";
import { normalizeBitbucketRepo } from "@/lib/repos/normalize";
import type { RepoSummary } from "@/lib/repos-api";

/**
 * GET /api/bitbucket-custom/repos
 *
 * Lists repositories in the stored Bitbucket workspace. Workspace and
 * basic-auth credentials are loaded server-side; the API token never
 * crosses the wire to the client.
 *
 * Returns up to 100 repos sorted by `updated_on` desc. Other workspaces
 * are out of scope for this picker — those land via URL paste.
 */

const PAGELEN = 100;
const FETCH_TIMEOUT_MS = 10_000;

async function getHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const creds = await loadCredentials();
  if (!creds) {
    return Response.json({ error: "Bitbucket is not connected" }, { status: 412 });
  }
  const auth = Buffer.from(`${creds.email}:${creds.apiToken}`, "utf-8").toString("base64");
  const url = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(creds.workspace)}?pagelen=${PAGELEN}&sort=-updated_on`;
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return Response.json(
      {
        error: `Could not reach api.bitbucket.org: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }
  if (upstream.status === 401) {
    return Response.json(
      { error: "Bitbucket rejected the stored credentials (401)." },
      { status: 412 },
    );
  }
  if (!upstream.ok) {
    return Response.json(
      { error: `Bitbucket repositories returned ${upstream.status}` },
      { status: 502 },
    );
  }
  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return Response.json({ error: "Bitbucket returned a non-JSON body" }, { status: 502 });
  }
  if (!payload || typeof payload !== "object") {
    return Response.json({ error: "Bitbucket returned an unexpected shape" }, { status: 502 });
  }
  const values = (payload as { values?: unknown }).values;
  if (!Array.isArray(values)) {
    return Response.json(
      { error: "Bitbucket response is missing a values array" },
      { status: 502 },
    );
  }
  const repos: RepoSummary[] = [];
  for (const raw of values) {
    const summary = normalizeBitbucketRepo(raw as Parameters<typeof normalizeBitbucketRepo>[0]);
    if (summary) repos.push(summary);
  }
  const next = (payload as { next?: unknown }).next;
  return Response.json({
    repos,
    truncated: typeof next === "string" && next.length > 0,
  });
}

export const GET = withAudit(
  {
    route: "/api/bitbucket-custom/repos",
    label: "List Bitbucket repos",
    auditSuccessGets: true,
  },
  getHandler,
);
