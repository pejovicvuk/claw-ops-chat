import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { execGit, GitExecError } from "@/lib/git/exec";
import { safePath, SafePathError } from "@/lib/safe-path";
import type { GitLogEntry, GitLogResponse } from "@/lib/git/types";

const NOT_A_REPO: GitLogResponse = { isRepo: false, branch: null, entries: [] };
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

async function getHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  const url = new URL(request.url);
  const rawPath = url.searchParams.get("path") || "~";
  const branchParam = url.searchParams.get("branch");
  const limitParam = url.searchParams.get("limit");

  const limit = clampLimit(limitParam);

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

  // Branch validation: pass through git's own ref-name validator before
  // letting the value reach `git log`. Rejects `--upload-pack=...`,
  // leading dashes, `..`, etc.
  if (branchParam !== null && branchParam !== "") {
    try {
      const check = await execGit(["check-ref-format", "--branch", branchParam], { cwd: repoRoot });
      if (check.code !== 0) {
        return Response.json(
          { error: "Invalid branch name", code: "invalid_branch" },
          { status: 400 },
        );
      }
    } catch {
      return Response.json(
        { error: "Invalid branch name", code: "invalid_branch" },
        { status: 400 },
      );
    }
  }

  try {
    const args = ["log", `-${limit}`, "--format=%H%x00%h%x00%an%x00%ae%x00%at%x00%P%x00%s"];
    if (branchParam) args.push(branchParam);
    args.push("--");
    const result = await execGit(args, { cwd: repoRoot });
    if (result.code !== 0) {
      return Response.json({ error: result.stderr.trim() || "git log failed" }, { status: 500 });
    }
    let head: string | null = branchParam || null;
    if (!head) {
      const headRes = await execGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoRoot });
      if (headRes.code === 0) {
        const name = headRes.stdout.toString("utf-8").trim();
        head = name === "HEAD" ? null : name;
      }
    }
    const entries = parseLog(result.stdout.toString("utf-8"));
    const body: GitLogResponse = { isRepo: true, branch: head, entries };
    return Response.json(body);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to read git log" },
      { status: 500 },
    );
  }
}

function clampLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function parseLog(output: string): GitLogEntry[] {
  const out: GitLogEntry[] = [];
  for (const line of output.split("\n")) {
    if (!line) continue;
    const fields = line.split("\0");
    if (fields.length < 7) continue;
    const [sha, shortSha, authorName, authorEmail, atRaw, parentsRaw, subject] = fields;
    const at = parseInt(atRaw, 10);
    out.push({
      sha,
      shortSha,
      authorName,
      authorEmail,
      timestamp: Number.isFinite(at) ? at * 1000 : 0,
      subject,
      parents: parentsRaw ? parentsRaw.split(" ").filter(Boolean) : [],
    });
  }
  return out;
}

export const GET = withAudit(
  {
    route: "/api/git/log",
    subjectFrom: (req) => {
      const u = new URL(req.url);
      const path = u.searchParams.get("path") ?? "";
      const branch = u.searchParams.get("branch") ?? "";
      const limit = u.searchParams.get("limit") ?? "";
      return `${path}|${branch}|${limit}`;
    },
  },
  getHandler,
);
