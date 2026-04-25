import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { execGit, GitExecError } from "@/lib/git/exec";
import { parsePorcelainV2 } from "@/lib/git/parse-status";
import { safePath, SafePathError } from "@/lib/safe-path";
import type { GitStatusResponse } from "@/lib/git/types";

const NOT_A_REPO: GitStatusResponse = {
  isRepo: false,
  repoRoot: null,
  branch: null,
  detachedHead: null,
  ahead: null,
  behind: null,
  files: [],
};

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
    if (top.code !== 0) {
      // exit 128 = "not a git repository" — treat as a normal "no repo" answer.
      return Response.json(NOT_A_REPO);
    }
    repoRoot = top.stdout.toString("utf-8").trim();
    if (!repoRoot) return Response.json(NOT_A_REPO);
  } catch (err) {
    if (err instanceof GitExecError) {
      // Same: treat as "not a repo" so the client UI can hide the git button
      // without needing to distinguish error categories.
      return Response.json(NOT_A_REPO);
    }
    return Response.json({ error: "Failed to detect git repo" }, { status: 500 });
  }

  try {
    const status = await execGit(
      ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"],
      { cwd: repoRoot },
    );
    if (status.code !== 0) {
      return Response.json({ error: status.stderr.trim() || "git status failed" }, { status: 500 });
    }
    const parsed = parsePorcelainV2(status.stdout, repoRoot);
    const body: GitStatusResponse = {
      isRepo: true,
      repoRoot,
      branch: parsed.branch,
      detachedHead: parsed.detachedHead,
      ahead: parsed.ahead,
      behind: parsed.behind,
      files: parsed.files,
    };
    return Response.json(body);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to read git status" },
      { status: 500 },
    );
  }
}

export const GET = withAudit(
  {
    route: "/api/git/status",
    subjectFrom: (req) => new URL(req.url).searchParams.get("path") ?? null,
  },
  getHandler,
);
