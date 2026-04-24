import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shared state between the test file and the hoisted mock factory.
// vi.mock() factories run in a separate context and can NOT close over
// regular top-level variables — they'd see the initial snapshot and miss
// every `beforeEach` update. `vi.hoisted` is the supported escape hatch:
// the returned object is shared-by-reference between the test's scope and
// the factory, so mutating `state.root` in a test is visible to the mock.
const state = vi.hoisted(() => ({ root: "" }));

vi.mock("./paths", async () => {
  const { join: pJoin } = await import("path");
  const { existsSync: exists } = await import("fs");
  const { mkdir: mk } = await import("fs/promises");
  return {
    get JOBS_DIR() {
      return pJoin(state.root, ".jobs");
    },
    get RUNS_DIR() {
      return pJoin(state.root, ".runs");
    },
    get INDEX_PATH() {
      return pJoin(state.root, ".index.json");
    },
    get README_PATH() {
      return pJoin(state.root, "README.md");
    },
    get REPORTS_ROOT() {
      return state.root;
    },
    jobFilePath: (slug: string) => pJoin(state.root, ".jobs", `${slug}.md`),
    disabledJobFilePath: (slug: string) => pJoin(state.root, ".jobs", `${slug}.disabled.md`),
    jobRunsDir: (slug: string) => pJoin(state.root, ".runs", slug),
    runSidecarPath: (slug: string, runId: string) =>
      pJoin(state.root, ".runs", slug, `${runId}.json`),
    runLogPath: (slug: string, runId: string) =>
      pJoin(state.root, ".runs", slug, `${runId}.log.jsonl`),
    defaultOutputDir: (slug: string) => pJoin(state.root, slug),
    ensureReportsTree: async () => {
      if (!exists(state.root)) await mk(state.root, { recursive: true });
      const jobs = pJoin(state.root, ".jobs");
      const runs = pJoin(state.root, ".runs");
      if (!exists(jobs)) await mk(jobs, { recursive: true });
      if (!exists(runs)) await mk(runs, { recursive: true });
    },
  };
});

// Import AFTER the mock is registered.
const { countRunsForJob } = await import("./run-store");

describe("countRunsForJob", () => {
  beforeEach(async () => {
    state.root = await mkdtemp(join(tmpdir(), "reports-test-"));
  });
  afterEach(async () => {
    if (state.root && existsSync(state.root)) {
      await rm(state.root, { recursive: true, force: true });
    }
  });

  it("returns zero counts when the runs dir doesn't exist", async () => {
    const stats = await countRunsForJob("demo");
    expect(stats).toEqual({ total: 0, success: 0, error: 0, running: 0, lastRunAt: null });
  });

  it("sums statuses across sidecars", async () => {
    const dir = join(state.root, ".runs", "demo");
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
