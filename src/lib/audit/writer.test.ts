import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { existsSync } from "fs";
import { readFile, readdir, rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const TEST_ROOT = join(tmpdir(), `claw-audit-writer-test-${process.pid}-${Date.now()}`);

vi.mock("./paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./paths")>();
  return {
    ...actual,
    AUDIT_ROOT: TEST_ROOT,
    META_PATH: join(TEST_ROOT, ".meta.json"),
    README_PATH: join(TEST_ROOT, "README.md"),
    categoryDir: (cat: string) => join(TEST_ROOT, cat),
    dailyFilePath: (cat: string, atMs: number) =>
      join(TEST_ROOT, cat, `${new Date(atMs).toISOString().slice(0, 10)}.jsonl`),
    ensureAuditTree: async () => {
      await mkdir(TEST_ROOT, { recursive: true });
      for (const c of ["api", "cron", "session"]) {
        await mkdir(join(TEST_ROOT, c), { recursive: true });
      }
    },
  };
});

const { getAuditWriter } = await import("./writer");

beforeEach(async () => {
  if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
});

afterAll(async () => {
  if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
});

describe("AuditWriter", () => {
  it("appends one JSONL line per api event", async () => {
    const writer = getAuditWriter();
    await writer.api({
      type: "request_complete",
      severity: "info",
      actor: "user@example.com",
      subject: "POST /api/foo → 200",
      durationMs: 42,
      route: "/api/foo",
      method: "POST",
      statusCode: 200,
      details: {},
    });

    const today = new Date().toISOString().slice(0, 10);
    const filePath = join(TEST_ROOT, "api", `${today}.jsonl`);
    expect(existsSync(filePath)).toBe(true);
    const raw = await readFile(filePath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.category).toBe("api");
    expect(parsed.v).toBe(1);
    expect(parsed.actor).toBe("user@example.com");
    expect(parsed.route).toBe("/api/foo");
    expect(typeof parsed.at).toBe("number");
    // id is assigned by reader, not persisted.
    expect(parsed.id).toBeUndefined();
  });

  it("scrubs secret-like fields before writing", async () => {
    const writer = getAuditWriter();
    await writer.session({
      type: "user_message",
      severity: "info",
      actor: "user@example.com",
      subject: "Bearer abc.def.ghi-jkl",
      durationMs: null,
      sessionId: "sess-1",
      details: { token: "super-secret", request: "Bearer abc.def.ghi-jkl" },
    });

    const today = new Date().toISOString().slice(0, 10);
    const raw = await readFile(join(TEST_ROOT, "session", `${today}.jsonl`), "utf-8");
    expect(raw).not.toContain("super-secret");
    expect(raw).not.toContain("abc.def.ghi-jkl");
    expect(raw).toContain("<redacted>");
  });

  it("writes each category to its own directory", async () => {
    const writer = getAuditWriter();
    await writer.api({
      type: "request_complete",
      severity: "info",
      actor: "x",
      subject: "s",
      durationMs: null,
      route: "/a",
      method: "GET",
      statusCode: 200,
      details: {},
    });
    await writer.cron({
      type: "run_start",
      severity: "info",
      actor: "x",
      subject: "s",
      durationMs: null,
      slug: "job1",
      details: {},
    });
    await writer.session({
      type: "connected",
      severity: "info",
      actor: "x",
      subject: "s",
      durationMs: null,
      sessionId: "s1",
      details: {},
    });

    const apiFiles = await readdir(join(TEST_ROOT, "api"));
    const cronFiles = await readdir(join(TEST_ROOT, "cron"));
    const sessionFiles = await readdir(join(TEST_ROOT, "session"));
    expect(apiFiles.length).toBe(1);
    expect(cronFiles.length).toBe(1);
    expect(sessionFiles.length).toBe(1);
  });
});
