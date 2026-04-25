import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { execGit, GitExecError } from "@/lib/git/exec";
import { safePath, SafePathError } from "@/lib/safe-path";
import type { GitBranch, GitBranchesResponse } from "@/lib/git/types";

const NOT_A_REPO: GitBranchesResponse = { isRepo: false, branches: [] };

async function getHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  const url = new URL(request.url);
  const rawPath = url.searchParams.get("path") || "~";

  let dirPath: string;
  try {
    dirPath = await safePath(rawPath);
  } catch (err) {
    if (err instanceof SafePathError) {
      return Response.json({ error: "Access denied", code: "safe_path" }, { status: 403 });
    }
    return Response.json({ error: "Invalid path", code: "invalid_path" }, { status: 400 });
  }

  let repoRoot: string;
  try {
    const top = await execGit(["rev-parse", "--show-toplevel"], { cwd: dirPath });
    if (top.code !== 0) return Response.json(NOT_A_REPO);
    repoRoot = top.stdout.toString("utf-8").trim();
    if (!repoRoot) return Response.json(NOT_A_REPO);
  } catch (err) {
    if (err instanceof GitExecError) return Response.json(NOT_A_REPO);
    return Response.json({ error: "Failed to detect git repo" }, { status: 500 });
  }

  try {
    const result = await execGit(
      [
        "for-each-ref",
        "--format=%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(objectname:short)%00%(subject)",
        "refs/heads",
      ],
      { cwd: repoRoot },
    );
    if (result.code !== 0) {
      return Response.json(
        { error: result.stderr.trim() || "git for-each-ref failed" },
        { status: 500 },
      );
    }
    const branches = parseBranches(result.stdout.toString("utf-8"));
    const body: GitBranchesResponse = { isRepo: true, branches };
    return Response.json(body);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to list branches" },
      { status: 500 },
    );
  }
}

function parseBranches(output: string): GitBranch[] {
  const out: GitBranch[] = [];
  for (const line of output.split("\n")) {
    if (!line) continue;
    const fields = line.split("\0");
    if (fields.length < 5) continue;
    const [name, headMarker, upstream, sha, subject] = fields;
    out.push({
      name,
      current: headMarker === "*",
      upstream: upstream || null,
      sha,
      tipSubject: subject,
    });
  }
  // Current branch first, then alphabetical.
  out.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

export const GET = withAudit(
  {
    route: "/api/git/branches",
    subjectFrom: (req) => new URL(req.url).searchParams.get("path") ?? null,
  },
  getHandler,
);
