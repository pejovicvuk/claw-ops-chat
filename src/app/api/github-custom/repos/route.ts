import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { loadCredentials } from "@/lib/github-custom-config";
import { githubHasNextPage, normalizeGithubRepo } from "@/lib/repos/normalize";
import type { RepoSummary } from "@/lib/repos-api";

/**
 * GET /api/github-custom/repos
 *
 * Lists the connected user's GitHub repositories — owner + collaborator +
 * organization-member affiliations. The PAT is loaded server-side and
 * never crosses the wire to the client.
 *
 * Returns up to 100 repos sorted by recent activity. If GitHub indicates
 * more pages exist, we set `truncated: true` so the picker can hint the
 * user toward the URL paste fallback for older repos.
 */

const PER_PAGE = 100;
const FETCH_TIMEOUT_MS = 10_000;

async function getHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const creds = await loadCredentials();
  if (!creds) {
    return Response.json({ error: "GitHub is not connected" }, { status: 412 });
  }
  let upstream: Response;
  try {
    upstream = await fetch(
      `https://api.github.com/user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&per_page=${PER_PAGE}&page=1`,
      {
        headers: {
          Authorization: `Bearer ${creds.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "claw-ops-chat",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
  } catch (err) {
    return Response.json(
      {
        error: `Could not reach api.github.com: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }
  if (upstream.status === 401) {
    return Response.json({ error: "GitHub rejected the stored token (401)." }, { status: 412 });
  }
  if (!upstream.ok) {
    return Response.json(
      { error: `GitHub /user/repos returned ${upstream.status}` },
      { status: 502 },
    );
  }
  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return Response.json({ error: "GitHub returned a non-JSON body" }, { status: 502 });
  }
  if (!Array.isArray(payload)) {
    return Response.json(
      { error: "GitHub /user/repos returned an unexpected shape" },
      { status: 502 },
    );
  }
  const repos: RepoSummary[] = [];
  for (const raw of payload) {
    const summary = normalizeGithubRepo(raw as Parameters<typeof normalizeGithubRepo>[0]);
    if (summary) repos.push(summary);
  }
  return Response.json({
    repos,
    truncated: githubHasNextPage(upstream.headers.get("link")),
  });
}

export const GET = withAudit(
  {
    route: "/api/github-custom/repos",
    label: "List GitHub repos",
    auditSuccessGets: true,
  },
  getHandler,
);
