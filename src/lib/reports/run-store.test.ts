import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock paths so tests don't write to /root/reports. Must happen before the
// module under test is imported (vi.mock hoists, but we want a dynamic
// tmp dir per suite so each test run is isolated).
let TMP_ROOT = "";

vi.mock("./paths", async () => {
  // Stub returns resolved at call time from the mutable TMP_ROOT.
  return {
    get JOBS_DIR() {
      return join(TMP_ROOT, ".jobs");
    },
    get RUNS_DIR() {
      return join(TMP_ROOT, ".runs");
    },
    get INDEX_PATH() {
      return join(TMP_ROOT, ".index.json");
    },
    get README_PATH() {
      return join(TMP_ROOT, "README.md");
    },
    get REPORTS_ROOT() {
      return TMP_ROOT;
    },
    jobFilePath: (slug: string) => join(TMP_ROOT, ".jobs", `${slug}.md`),
    disabledJobFilePath: (slug: string) => join(TMP_ROOT, ".jobs", `${slug}.disabled.md`),
    jobRunsDir: (slug: string) => join(TMP_ROOT, ".runs", slug),
    runSidecarPath: (slug: string, runId: string) => join(TMP_ROOT, ".runs", slug, `${runId}.json`),
    runLogPath: (slug: string, runId: string) =>
      join(TMP_ROOT, ".runs", slug, `${runId}.log.jsonl`),
    defaultOutputDir: (slug: string) => join(TMP_ROOT, slug),
    ensureReportsTree: async () => {
      if (!existsSync(TMP_ROOT)) await mkdir(TMP_ROOT, { recursive: true });
      const jobs = join(TMP_ROOT, ".jobs");
      const runs = join(TMP_ROOT, ".runs");
      if (!existsSync(jobs)) await mkdir(jobs, { recursive: true });
      if (!existsSync(runs)) await mkdir(runs, { recursive: true });
    },
  };
});

// Import AFTER the mock is registered.
const { countRunsForJob } = await import("./run-store");

describe("countRunsForJob", () => {
  beforeEach(async () => {
    TMP_ROOT = await mkdtemp(join(tmpdir(), "reports-test-"));
  });
  afterEach(async () => {
    if (TMP_ROOT && existsSync(TMP_ROOT)) {
      await rm(TMP_ROOT, { recursive: true, force: true });
    }
  });

  it("returns zero counts when the runs dir doesn't exist", async () => {
    const stats = await countRunsForJob("demo");
    expect(stats).toEqual({ total: 0, success: 0, error: 0, running: 0, lastRunAt: null });
  });

  it("sums statuses across sidecars", async () => {
    const dir = join(TMP_ROOT, ".runs", "demo");
    await mkdir(dir, { recursive: true });
    const base = {
      jobId: "demo",
      triggeredBy: "cron" as const,
      cronTickAt: null,
      reportPath: null,
      claudeSessionId: null,
      turnsUsed: 0,
      toolCallsCount: 0,
      permissionDenials: [],
      tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
    };
    await writeFile(
      join(dir, "demo-2026-04-23T06-00-00Z.json"),
      JSON.stringify({
        ...base,
        runId: "demo-2026-04-23T06-00-00Z",
        startedAt: 1000,
        finishedAt: 2000,
        status: "success",
      }),
    );
    await writeFile(
      join(dir, "demo-2026-04-24T06-00-00Z.json"),
      JSON.stringify({
        ...base,
        runId: "demo-2026-04-24T06-00-00Z",
        startedAt: 3000,
        finishedAt: 4000,
        status: "error",
      }),
    );
    await writeFile(
      join(dir, "demo-2026-04-25T06-00-00Z.json"),
      JSON.stringify({
        ...base,
        runId: "demo-2026-04-25T06-00-00Z",
        startedAt: 5000,
        finishedAt: null,
        status: "running",
      }),
    );

    const stats = await countRunsForJob("demo");
    expect(stats.total).toBe(3);
    expect(stats.success).toBe(1);
    expect(stats.error).toBe(1);
    expect(stats.running).toBe(1);
    expect(stats.lastRunAt).toBe(5000);
  });

  it("rejects invalid slugs", async () => {
    await expect(countRunsForJob("../escape")).rejects.toThrow();
  });
});
