// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { realpath } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { execGit } from "@/lib/git/exec";

vi.mock("@/lib/auth-server", () => ({
  extractSession: () => ({ email: "test@example.com" }),
  unauthorized: () => Response.json({ error: "Unauthorized" }, { status: 401 }),
}));

vi.mock("@/lib/audit/api-wrap", () => ({
  withAudit:
    <Ctx>(_opts: unknown, handler: (req: Request, ctx?: Ctx) => Promise<Response>) =>
    (req: Request, ctx?: Ctx) =>
      handler(req, ctx),
}));

vi.mock("@/lib/safe-path", () => ({
  SafePathError: class SafePathError extends Error {},
  safePath: async (p: string) => p,
  safeFilename: (n: string) => n,
}));

let repoRoot: string;
let firstSha = "";
let secondSha = "";
let mergeSha = "";

beforeAll(async () => {
  repoRoot = await realpath(await mkdtemp(join(tmpdir(), "claw-cdiff-")));
  await execGit(["init", "-b", "main"], { cwd: repoRoot });
  await execGit(["config", "user.email", "t@t.t"], { cwd: repoRoot });
  await execGit(["config", "user.name", "t"], { cwd: repoRoot });
  await execGit(["config", "commit.gpgsign", "false"], { cwd: repoRoot });

  // First (root) commit: add a.txt
  await writeFile(join(repoRoot, "a.txt"), "alpha\n");
  await execGit(["add", "a.txt"], { cwd: repoRoot });
  await execGit(["commit", "-m", "first"], { cwd: repoRoot });
  firstSha = (await execGit(["rev-parse", "HEAD"], { cwd: repoRoot })).stdout
    .toString("utf-8")
    .trim();

  // Second commit on main: edit a.txt + add b.txt
  await writeFile(join(repoRoot, "a.txt"), "alpha\nbeta\n");
  await writeFile(join(repoRoot, "b.txt"), "boop\n");
  await execGit(["add", "a.txt", "b.txt"], { cwd: repoRoot });
  await execGit(["commit", "-m", "second"], { cwd: repoRoot });
  secondSha = (await execGit(["rev-parse", "HEAD"], { cwd: repoRoot })).stdout
    .toString("utf-8")
    .trim();

  // Branch off, divergent change, merge back to produce a merge commit.
  await execGit(["checkout", "-b", "side", firstSha], { cwd: repoRoot });
  await writeFile(join(repoRoot, "side.txt"), "from side\n");
  await execGit(["add", "side.txt"], { cwd: repoRoot });
  await execGit(["commit", "-m", "side change"], { cwd: repoRoot });
  await execGit(["checkout", "main"], { cwd: repoRoot });
  await execGit(["merge", "--no-ff", "-m", "merge side", "side"], { cwd: repoRoot });
  mergeSha = (await execGit(["rev-parse", "HEAD"], { cwd: repoRoot })).stdout
    .toString("utf-8")
    .trim();
});

afterAll(async () => {
  if (repoRoot) await rm(repoRoot, { recursive: true, force: true });
});

async function callGet(path: string, sha: string): Promise<Response> {
  const { GET } = await import("./route");
  const url = new URL("http://localhost/api/git/commit-diff");
  url.searchParams.set("path", path);
  url.searchParams.set("sha", sha);
  return GET(new Request(url.toString()), {});
}

describe("/api/git/commit-diff GET", () => {
  it("rejects bad SHA shape with 400", async () => {
    const res = await callGet(repoRoot, "not-a-sha");
    expect(res.status).toBe(400);
  });

  it("rejects missing path with 400", async () => {
    const res = await callGet("", firstSha);
    expect(res.status).toBe(400);
  });

  it("returns isRepo:false outside any git repo", async () => {
    const outside = await mkdtemp(join(tmpdir(), "claw-no-cdiff-"));
    try {
      const res = await callGet(join(outside, "x"), firstSha);
      const body = await res.json();
      expect(body).toMatchObject({ isRepo: false, found: false });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("returns found:false for an unknown SHA shape that's well-formed", async () => {
    const fakeSha = "0000000000000000000000000000000000000000";
    const res = await callGet(repoRoot, fakeSha);
    const body = await res.json();
    expect(body).toMatchObject({ isRepo: true, found: false });
  });

  it("returns full additions for the root commit", async () => {
    const res = await callGet(repoRoot, firstSha);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.isMerge).toBe(false);
    expect(body.stats.files).toBe(1);
    expect(body.stats.insertions).toBe(1);
    expect(body.stats.deletions).toBe(0);
    expect(body.diff).toContain("+alpha");
  });

  it("returns multi-file stats and diff for a regular commit", async () => {
    const res = await callGet(repoRoot, secondSha);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.isMerge).toBe(false);
    expect(body.stats.files).toBe(2);
    expect(body.stats.insertions).toBe(2);
    expect(body.diff).toContain("+beta");
    expect(body.diff).toContain("+boop");
  });

  it("flags merge commits and returns first-parent diff", async () => {
    const res = await callGet(repoRoot, mergeSha);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.isMerge).toBe(true);
    // First-parent diff vs main HEAD before merge → side.txt added.
    expect(body.diff).toContain("side.txt");
  });
});
