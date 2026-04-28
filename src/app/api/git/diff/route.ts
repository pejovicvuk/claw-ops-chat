import { dirname, relative } from "path";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { execGit, GitExecError } from "@/lib/git/exec";
import { safePath, SafePathError } from "@/lib/safe-path";
import type { DiffAgainst, GitDiffResponse } from "@/lib/git/types";

const NOT_A_REPO: GitDiffResponse = { isRepo: false, tracked: false, diff: "" };
const NOT_TRACKED: GitDiffResponse = { isRepo: true, tracked: false, diff: "" };
const MAX_DIFF_BYTES = 4 * 1024 * 1024;

function parseAgainst(raw: string | null): DiffAgainst {
  return raw === "head" || raw === "staged" ? raw : "working";
}

async function getHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  const url = new URL(request.url);
  const rawPath = url.searchParams.get("path") || "";
  const against = parseAgainst(url.searchParams.get("against"));

  if (!rawPath) {
    return Response.json({ error: "Missing path", code: "invalid_path" }, { status: 400 });
  }

  let filePath: string;
  try {
    filePath = await safePath(rawPath);
  } catch (err) {
    if (err instanceof SafePathError) {
      return Response.json({ error: "Access denied", code: "safe_path" }, { status: 403 });
    }
    return Response.json({ error: "Invalid path", code: "invalid_path" }, { status: 400 });
  }

  let repoRoot: string;
  try {
    const top = await execGit(["rev-parse", "--show-toplevel"], { cwd: dirname(filePath) });
    if (top.code !== 0) return Response.json(NOT_A_REPO);
    repoRoot = top.stdout.toString("utf-8").trim();
    if (!repoRoot) return Response.json(NOT_A_REPO);
  } catch (err) {
    if (err instanceof GitExecError) return Response.json(NOT_A_REPO);
    return Response.json({ error: "Failed to detect git repo" }, { status: 500 });
  }

  const relPath = relative(repoRoot, filePath);
  if (!relPath || relPath.startsWith("..")) {
    return Response.json(NOT_A_REPO);
  }

  // Untracked file → no diff to show. We deliberately use ls-files
  // (not status) because we want a true tracked/untracked verdict
  // independent of working-tree state.
  try {
    const ls = await execGit(["ls-files", "--error-unmatch", "--", relPath], {
      cwd: repoRoot,
    });
    if (ls.code !== 0) return Response.json(NOT_TRACKED);
  } catch (err) {
    if (err instanceof GitExecError) return Response.json(NOT_TRACKED);
    return Response.json({ error: "Failed to check tracking status" }, { status: 500 });
  }

  const diffArgs = (() => {
    switch (against) {
      case "head":
        return ["diff", "HEAD", "--", relPath];
      case "staged":
        return ["diff", "--cached", "--", relPath];
      default:
        return ["diff", "--", relPath];
    }
  })();

  try {
    const result = await execGit(diffArgs, { cwd: repoRoot, maxBuffer: MAX_DIFF_BYTES });
    if (result.code !== 0) {
      return Response.json({ error: result.stderr.trim() || "git diff failed" }, { status: 500 });
    }
    const body: GitDiffResponse = {
      isRepo: true,
      tracked: true,
      diff: result.stdout.toString("utf-8"),
    };
    return Response.json(body);
  } catch (err) {
    if (err instanceof GitExecError && err.code === "buffer") {
      const body: GitDiffResponse = {
        isRepo: true,
        tracked: true,
        diff: "",
        error: "diff too large",
      };
      return Response.json(body);
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to read git diff" },
      { status: 500 },
    );
  }
}

export const GET = withAudit(
  {
    route: "/api/git/diff",
    subjectFrom: (req) => {
      const u = new URL(req.url);
      const path = u.searchParams.get("path") ?? "";
      const against = u.searchParams.get("against") ?? "working";
      return `${against}:${path}`;
    },
  },
  getHandler,
);
