import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { join } from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock auth + audit before importing the route. Both are wrapped around
// the handler at module-load time, so the mocks must be in place first.
vi.mock("@/lib/auth-server", () => ({
  extractSession: () => ({ email: "test@example.com" }),
  unauthorized: () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
}));

vi.mock("@/lib/audit/api-wrap", () => ({
  withAudit: <Ctx>(_opts: unknown, handler: (req: Request, ctx: Ctx) => Promise<Response>) =>
    handler,
}));

const SANDBOX = process.env.CLAUDE_CWD || "/tmp/claw-ops-test-sandbox";
const TEST_DIR = join(SANDBOX, "write-route-test");

const { POST } = await import("./route");

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/files/write", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

beforeEach(async () => {
  // Each test starts from a clean slate — remove the dir + recreate.
  const { rm } = await import("fs/promises");
  await rm(TEST_DIR, { recursive: true, force: true });
  await mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  const { rm } = await import("fs/promises");
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("/api/files/write POST", () => {
  it("writes a new file and returns its mtimeMs", async () => {
    const filePath = join(TEST_DIR, "new.txt");
    const res = await POST(postRequest({ path: filePath, content: "hello" }), {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; mtimeMs: number };
    expect(body.ok).toBe(true);
    expect(typeof body.mtimeMs).toBe("number");
    expect(body.mtimeMs).toBeGreaterThan(0);
    expect(await readFile(filePath, "utf-8")).toBe("hello");
  });

  it("overwrites unconditionally when expectedMtimeMs is omitted", async () => {
    const filePath = join(TEST_DIR, "existing.txt");
    await writeFile(filePath, "v1", "utf-8");
    const res = await POST(postRequest({ path: filePath, content: "v2" }), {});
    expect(res.status).toBe(200);
    expect(await readFile(filePath, "utf-8")).toBe("v2");
  });

  it("returns 409 with stale_mtime when expectedMtimeMs does not match disk", async () => {
    const filePath = join(TEST_DIR, "stale.txt");
    await writeFile(filePath, "on-disk-version", "utf-8");
    const onDisk = await stat(filePath);
    const stale = onDisk.mtimeMs - 5_000;

    const res = await POST(
      postRequest({ path: filePath, content: "client-overwrite", expectedMtimeMs: stale }),
      {},
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      code: string;
      currentMtimeMs: number;
      currentContent: string;
    };
    expect(body.code).toBe("stale_mtime");
    expect(body.currentMtimeMs).toBe(onDisk.mtimeMs);
    expect(body.currentContent).toBe("on-disk-version");
    // File on disk must NOT have been overwritten.
    expect(await readFile(filePath, "utf-8")).toBe("on-disk-version");
  });

  it("writes when expectedMtimeMs matches disk within 1 ms tolerance", async () => {
    const filePath = join(TEST_DIR, "match.txt");
    await writeFile(filePath, "before", "utf-8");
    const s = await stat(filePath);
    const res = await POST(
      postRequest({ path: filePath, content: "after", expectedMtimeMs: s.mtimeMs }),
      {},
    );
    expect(res.status).toBe(200);
    expect(await readFile(filePath, "utf-8")).toBe("after");
  });

  it("returns 409 stale_mtime with null currents when file was deleted under us", async () => {
    const filePath = join(TEST_DIR, "deleted.txt");
    const res = await POST(
      postRequest({ path: filePath, content: "x", expectedMtimeMs: 12345 }),
      {},
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      code: string;
      currentMtimeMs: number | null;
      currentContent: string | null;
    };
    expect(body.code).toBe("stale_mtime");
    expect(body.currentMtimeMs).toBeNull();
    expect(body.currentContent).toBeNull();
  });

  it("rejects missing fields with 400", async () => {
    const res = await POST(postRequest({ path: "" }), {});
    expect(res.status).toBe(400);
  });
});
