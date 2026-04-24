import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdir, writeFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { rm } from "fs/promises";

// Force AUDIT_ROOT to a tmp dir before the module loads.
const TEST_ROOT = join(tmpdir(), `claw-audit-test-${process.pid}-${Date.now()}`);

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
  };
});

const { purgeOldAuditFiles } = await import("./retention");

function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

async function setupFiles(
  files: Array<{ cat: string; name: string; bytes?: number }>,
): Promise<void> {
  for (const f of files) {
    const dir = join(TEST_ROOT, f.cat);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, f.name), "x".repeat(f.bytes ?? 10), "utf-8");
  }
}

beforeEach(async () => {
  if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  await mkdir(TEST_ROOT, { recursive: true });
});

afterAll(async () => {
  if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
});

describe("purgeOldAuditFiles", () => {
  it("deletes files older than 30 days", async () => {
    await setupFiles([
      { cat: "api", name: `${daysAgo(45)}.jsonl` },
      { cat: "api", name: `${daysAgo(31)}.jsonl` },
      { cat: "api", name: `${daysAgo(5)}.jsonl` },
      { cat: "cron", name: `${daysAgo(90)}.jsonl` },
      { cat: "session", name: `${daysAgo(0)}.jsonl` },
    ]);

    const result = await purgeOldAuditFiles();

    expect(result.deleted.length).toBe(3);
    const remainingApi = await readdir(join(TEST_ROOT, "api"));
    expect(remainingApi).toEqual([`${daysAgo(5)}.jsonl`]);
  });

  it("respects categoryFilter", async () => {
    await setupFiles([
      { cat: "api", name: `${daysAgo(60)}.jsonl` },
      { cat: "cron", name: `${daysAgo(60)}.jsonl` },
    ]);

    const result = await purgeOldAuditFiles(undefined, "api");

    expect(result.deleted.length).toBe(1);
    expect(result.deleted[0]).toBe(`api/${daysAgo(60)}.jsonl`);
    expect(existsSync(join(TEST_ROOT, "cron", `${daysAgo(60)}.jsonl`))).toBe(true);
  });

  it("deletes everything when maxAgeMs is 0", async () => {
    await setupFiles([
      { cat: "api", name: `${daysAgo(0)}.jsonl` },
      { cat: "api", name: `${daysAgo(1)}.jsonl` },
    ]);

    const result = await purgeOldAuditFiles(0, "api");

    expect(result.deleted.length).toBe(2);
  });

  it("ignores non-jsonl files", async () => {
    await setupFiles([
      { cat: "api", name: "notes.txt" },
      { cat: "api", name: `${daysAgo(60)}.jsonl` },
    ]);

    const result = await purgeOldAuditFiles();

    expect(result.deleted).toEqual([`api/${daysAgo(60)}.jsonl`]);
    expect(existsSync(join(TEST_ROOT, "api", "notes.txt"))).toBe(true);
  });

  it("is idempotent on an empty tree", async () => {
    const result = await purgeOldAuditFiles();
    expect(result.deleted).toEqual([]);
    expect(result.bytesFreed).toBe(0);
  });
});
