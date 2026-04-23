import { describe, expect, it } from "vitest";
import { assemblePrompt, resolveOutputFilename, resolveOutputPath } from "./prompt-assembler";
import type { ReportJob } from "./types";

function baseJob(overrides: Partial<ReportJob> = {}): ReportJob {
  return {
    id: "demo",
    slug: "demo",
    name: "Demo",
    schedule: "0 6 * * *",
    timezone: "UTC",
    enabled: true,
    version: 1,
    maxTurns: 10,
    maxDurationSec: 60,
    concurrency: "skip",
    allowedTools: ["Write"],
    allowedBashPrefixes: [],
    allowedMcpServers: [],
    outputDir: "/root/reports/demo",
    outputFilename: "{date}-demo.md",
    notifyOnComplete: true,
    notifyOnError: true,
    prompt: "Write to {{outputPath}} for job {{slug}}",
    ...overrides,
  };
}

const FIXED_DATE = new Date("2026-04-23T06:00:00Z");

describe("resolveOutputFilename", () => {
  it("substitutes {date} and {slug}", () => {
    const filename = resolveOutputFilename({
      job: baseJob({ outputFilename: "{date}-{slug}.md" }),
      runId: "demo-2026-04-23T06-00-00Z",
      now: FIXED_DATE,
    });
    expect(filename).toBe("2026-04-23-demo.md");
  });
});

describe("resolveOutputPath", () => {
  it("joins outputDir and resolved filename", () => {
    const p = resolveOutputPath({
      job: baseJob(),
      runId: "demo-2026-04-23T06-00-00Z",
      now: FIXED_DATE,
    });
    expect(p).toBe("/root/reports/demo/2026-04-23-demo.md");
  });
});

describe("assemblePrompt", () => {
  it("substitutes {{outputPath}} and {{slug}} in the body", () => {
    const { prompt, outputPath } = assemblePrompt({
      job: baseJob(),
      runId: "demo-2026-04-23T06-00-00Z",
      now: FIXED_DATE,
    });
    expect(outputPath).toBe("/root/reports/demo/2026-04-23-demo.md");
    expect(prompt).toContain(`Write to ${outputPath} for job demo`);
  });

  it("appends the environment envelope", () => {
    const { prompt } = assemblePrompt({
      job: baseJob(),
      runId: "demo-2026-04-23T06-00-00Z",
      now: FIXED_DATE,
    });
    expect(prompt).toContain("ENVIRONMENT");
    expect(prompt).toContain("Job ID / slug: demo / demo");
    expect(prompt).toContain("auto-denied");
  });
});
