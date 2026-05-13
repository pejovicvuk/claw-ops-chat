import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportJob } from "./types";
import type { CronCapableSessionManager, CronRunOutcome } from "./runner";

// See run-store.test.ts for the shape of this pattern — paths.ts is
// re-mocked so REPORTS_ROOT points at a tmpdir, and we import everything
// downstream AFTER the mock is registered so the dependencies pick up
// the same mock module.
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

const { executeRun } = await import("./runner");
const { readIndex, listRunsForJob } = await import("./run-store");

function makeJob(overrides: Partial<ReportJob> = {}): ReportJob {
  return {
    id: "demo",
    name: "Demo Report",
    schedule: "0 9 * * *",
    timezone: "UTC",
    enabled: true,
    version: 1,
    maxTurns: 5,
    maxDurationSec: 60,
    concurrency: "skip",
    allowedTools: ["Read", "Write"],
    allowedBashPrefixes: [],
    allowedMcpServers: [],
    outputDir: join(state.root, "demo"),
    outputFilename: "{date}.md",
    slug: "demo",
    notifyOnComplete: true,
    notifyOnError: true,
    prompt: "Write a brief status report.",
    ...overrides,
  };
}

function fakeOutcome(overrides: Partial<CronRunOutcome> = {}): CronRunOutcome {
  return {
    claudeSessionId: "sdk-session-1",
    turnsUsed: 2,
    toolCallsCount: 0,
    denials: [],
    tokenUsage: { input: 10, output: 20, cacheRead: 0, cacheCreate: 0 },
    isError: false,
    ...overrides,
  };
}

describe("executeRun", () => {
  beforeEach(async () => {
    state.root = await mkdtemp(join(tmpdir(), "runner-test-"));
  });
  afterEach(async () => {
    if (state.root && existsSync(state.root)) {
      await rm(state.root, { recursive: true, force: true });
    }
  });

  it("marks the run as success and writes both sidecar + index when Claude produces the file", async () => {
    const job = makeJob();
    // Refresh outputDir to use the per-test tmp root.
    job.outputDir = join(state.root, "demo");
    await mkdir(job.outputDir, { recursive: true });

    const sessionManager: CronCapableSessionManager = {
      async runCron({ cwd }) {
        // Simulate Claude writing the report file before the runner
        // verifies it.
        const date = new Date().toISOString().slice(0, 10);
        await writeFile(join(cwd, `${date}.md`), "# Demo\n\nSome content.");
        return fakeOutcome();
      },
    };

    const run = await executeRun({
      job,
      trigger: "manual",
      cronTickAt: null,
      sessionManager,
    });

    expect(run.status).toBe("success");
    expect(run.reportPath).toBeTruthy();
    expect(run.jobId).toBe("demo");
    expect(run.claudeSessionId).toBe("sdk-session-1");

    const sidecars = await listRunsForJob("demo");
    expect(sidecars).toHaveLength(1);
    expect(sidecars[0].status).toBe("success");

    const index = await readIndex();
    expect(index.runs).toHaveLength(1);
    expect(index.runs[0].runId).toBe(run.runId);
    expect(index.runs[0].status).toBe("success");
    expect(index.runs[0].readAt).toBeNull();
  });

  it("marks the run as error when no report file is produced", async () => {
    const job = makeJob();
    job.outputDir = join(state.root, "demo");
    await mkdir(job.outputDir, { recursive: true });

    const sessionManager: CronCapableSessionManager = {
      async runCron() {
        // Claude returns "successfully" but doesn't write anything.
        return fakeOutcome();
      },
    };

    const run = await executeRun({
      job,
      trigger: "cron",
      cronTickAt: Date.now(),
      sessionManager,
    });

    expect(run.status).toBe("error");
    expect(run.reportPath).toBeNull();
    expect(run.errorMessage).toContain("expected report file");

    const index = await readIndex();
    expect(index.runs[0].status).toBe("error");
  });

  it("captures the error when the session manager throws mid-run", async () => {
    const job = makeJob();
    job.outputDir = join(state.root, "demo");

    const sessionManager: CronCapableSessionManager = {
      async runCron() {
        throw new Error("SDK exploded");
      },
    };

    const run = await executeRun({
      job,
      trigger: "manual",
      cronTickAt: null,
      sessionManager,
    });

    expect(run.status).toBe("error");
    expect(run.errorMessage).toBe("SDK exploded");
    expect(run.reportPath).toBeNull();

    const index = await readIndex();
    expect(index.runs[0].status).toBe("error");
  });
});
