import { stat } from "fs/promises";
import { dirname } from "path";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { execGit, GitExecError } from "@/lib/git/exec";
import { safePath, SafePathError } from "@/lib/safe-path";
import type { GitCommitDiffResponse, GitCommitDiffStats } from "@/lib/git/types";

const NOT_A_REPO: GitCommitDiffResponse = {
  isRepo: false,
  found: false,
  isMerge: false,
  stats: { files: 0, insertions: 0, deletions: 0 },
  diff: "",
};

const NOT_FOUND: GitCommitDiffResponse = {
  isRepo: true,
  found: false,
  isMerge: false,
  stats: { files: 0, insertions: 0, deletions: 0 },
  diff: "",
};

const MAX_DIFF_BYTES = 4 * 1024 * 1024;
// SHAs are 4–40 hex chars in practice; allow 4–64 to be future-proof against
// SHA-256 repos. Anything outside this is rejected before it can reach git.
const SHA_RE = /^[0-9a-f]{4,64}$/i;

function parseNumstat(out: string): GitCommitDiffStats {
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  for (const raw of out.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // numstat format: "<add>\t<del>\t<path>" — "-" for binary files.
    const fields = line.split("\t");
    if (fields.length < 3) continue;
    files += 1;
    const add = parseInt(fields[0], 10);
    const del = parseInt(fields[1], 10);
    if (Number.isFinite(add)) insertions += add;
    if (Number.isFinite(del)) deletions += del;
  }
  return { files, insertions, deletions };
}

async function getHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  const url = new URL(request.url);
  const rawPath = url.searchParams.get("path") || "";
  const sha = url.searchParams.get("sha") || "";

  if (!rawPath) {
    return Response.json({ error: "Missing path", code: "invalid_path" }, { status: 400 });
  }
  if (!SHA_RE.test(sha)) {
    return Response.json({ error: "Invalid sha", code: "invalid_sha" }, { status: 400 });
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

  // execGit needs a directory cwd. The caller may pass a file or a folder
  // — stat the path so we use the path itself when it's a directory.
  let probeDir = filePath;
  try {
    const st = await stat(filePath);
    if (!st.isDirectory()) probeDir = dirname(filePath);
  } catch {
    probeDir = dirname(filePath);
  }

  let repoRoot: string;
  try {
    const top = await execGit(["rev-parse", "--show-toplevel"], { cwd: probeDir });
    if (top.code !== 0) return Response.json(NOT_A_REPO);
    repoRoot = top.stdout.toString("utf-8").trim();
    if (!repoRoot) return Response.json(NOT_A_REPO);
  } catch (err) {
    if (err instanceof GitExecError) return Response.json(NOT_A_REPO);
    return Response.json({ error: "Failed to detect git repo" }, { status: 500 });
  }

  // Confirm the SHA resolves to a commit in this repo. cat-file -t avoids
  // pulling the whole object — we just need "commit" or non-zero.
  let isMerge = false;
  try {
    const exists = await execGit(["cat-file", "-t", sha], { cwd: repoRoot });
    if (exists.code !== 0 || exists.stdout.toString("utf-8").trim() !== "commit") {
      return Response.json(NOT_FOUND);
    }
    const parents = await execGit(["rev-list", "--parents", "-n", "1", sha], {
      cwd: repoRoot,
    });
    if (parents.code === 0) {
      const fields = parents.stdout.toString("utf-8").trim().split(/\s+/);
      // Output: "<sha> <p1> [<p2> …]"; ≥3 fields → merge commit.
      isMerge = fields.length >= 3;
    }
  } catch (err) {
    if (err instanceof GitExecError) return Response.json(NOT_FOUND);
    return Response.json({ error: "Failed to inspect commit" }, { status: 500 });
  }

  // For merges, --first-parent gives a single linear diff that's much more
  // useful than the default empty / combined output. -m forces git show to
  // emit a diff for merge commits at all.
  const mergeFlags = isMerge ? ["-m", "--first-parent"] : [];

  try {
    const [statRes, diffRes] = await Promise.all([
      execGit(["show", "--no-color", "--format=", "--numstat", ...mergeFlags, sha], {
        cwd: repoRoot,
      }),
      execGit(["show", "--no-color", "--format=", "-p", ...mergeFlags, sha], {
        cwd: repoRoot,
        maxBuffer: MAX_DIFF_BYTES,
      }),
    ]);

    if (statRes.code !== 0) {
      return Response.json(
        { error: statRes.stderr.trim() || "git show --numstat failed" },
        { status: 500 },
      );
    }
    if (diffRes.code !== 0) {
      return Response.json(
        { error: diffRes.stderr.trim() || "git show -p failed" },
        { status: 500 },
      );
    }

    const stats = parseNumstat(statRes.stdout.toString("utf-8"));
    const body: GitCommitDiffResponse = {
      isRepo: true,
      found: true,
      isMerge,
      stats,
      diff: diffRes.stdout.toString("utf-8"),
    };
    return Response.json(body);
  } catch (err) {
    if (err instanceof GitExecError && err.code === "buffer") {
      const body: GitCommitDiffResponse = {
        isRepo: true,
        found: true,
        isMerge,
        stats: { files: 0, insertions: 0, deletions: 0 },
        diff: "",
        error: "diff too large",
      };
      return Response.json(body);
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to read commit diff" },
      { status: 500 },
    );
  }
}

export const GET = withAudit(
  {
    route: "/api/git/commit-diff",
    subjectFrom: (req) => new URL(req.url).searchParams.get("sha") ?? null,
  },
  getHandler,
);
