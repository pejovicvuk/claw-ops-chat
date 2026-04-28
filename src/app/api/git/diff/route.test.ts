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

// Identity safePath: tests pass real absolute paths inside their own
// tmpdir, so we don't need the production BASE_DIR rooting.
vi.mock("@/lib/safe-path", () => ({
  SafePathError: class SafePathError extends Error {},
  safePath: async (p: string) => p,
  safeFilename: (n: string) => n,
}));

let repoRoot: string;
let trackedFile: string;

beforeAll(async () => {
  repoRoot = await realpath(await mkdtemp(join(tmpdir(), "claw-diff-")));
  await execGit(["init", "-b", "main"], { cwd: repoRoot });
  await execGit(["config", "user.email", "t@t.t"], { cwd: repoRoot });
  await execGit(["config", "user.name", "t"], { cwd: repoRoot });
  await execGit(["config", "commit.gpgsign", "false"], { cwd: repoRoot });

  trackedFile = join(repoRoot, "hello.txt");
  await writeFile(trackedFile, "v1\n");
  await execGit(["add", "hello.txt"], { cwd: repoRoot });
  await execGit(["commit", "-m", "init"], { cwd: repoRoot });
});

afterAll(async () => {
  if (repoRoot) await rm(repoRoot, { recursive: true, force: true });
});

async function callGet(path: string, against?: string): Promise<Response> {
  const { GET } = await import("./route");
  const url = new URL("http://localhost/api/git/diff");
  url.searchParams.set("path", path);
  if (against) url.searchParams.set("against", against);
  return GET(new Request(url.toString()), {});
}

describe("/api/git/diff GET", () => {
  it("returns isRepo:false when path is outside any git repo", async () => {
    const outside = await mkdtemp(join(tmpdir(), "claw-no-repo-"));
    try {
      const res = await callGet(join(outside, "anywhere.txt"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ isRepo: false, tracked: false, diff: "" });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("returns tracked:false for an untracked file inside a repo", async () => {
    const untracked = join(repoRoot, "new-untracked.txt");
    await writeFile(untracked, "fresh\n");
    const res = await callGet(untracked);
    const body = await res.json();
    expect(body).toMatchObject({ isRepo: true, tracked: false, diff: "" });
  });

  it("returns the working-tree diff after editing a tracked file", async () => {
    await writeFile(trackedFile, "v1 modified\n");
    try {
      const res = await callGet(trackedFile, "working");
      const body = await res.json();
      expect(body.isRepo).toBe(true);
      expect(body.tracked).toBe(true);
      expect(body.diff).toContain("-v1");
      expect(body.diff).toContain("+v1 modified");
    } finally {
      await writeFile(trackedFile, "v1\n");
    }
  });

  it("returns the staged diff after `git add`", async () => {
    await writeFile(trackedFile, "staged change\n");
    await execGit(["add", "hello.txt"], { cwd: repoRoot });
    try {
      const res = await callGet(trackedFile, "staged");
      const body = await res.json();
      expect(body.tracked).toBe(true);
      expect(body.diff).toContain("+staged change");
    } finally {
      await execGit(["reset", "--hard", "HEAD"], { cwd: repoRoot });
    }
  });

  it("HEAD diff includes both staged and unstaged changes", async () => {
    await writeFile(trackedFile, "staged\n");
    await execGit(["add", "hello.txt"], { cwd: repoRoot });
    await writeFile(trackedFile, "staged + working\n");
    try {
      const res = await callGet(trackedFile, "head");
      const body = await res.json();
      expect(body.diff).toContain("+staged + working");
    } finally {
      await execGit(["reset", "--hard", "HEAD"], { cwd: repoRoot });
    }
  });

  it("rejects an empty path with 400", async () => {
    const res = await callGet("");
    expect(res.status).toBe(400);
  });
});
