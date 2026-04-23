import { describe, expect, it } from "vitest";
import { JOB_DEFAULTS } from "./job-parser";
import { validateCronExpression, validateJob } from "./job-validator";
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
    maxTurns: JOB_DEFAULTS.maxTurns,
    maxDurationSec: JOB_DEFAULTS.maxDurationSec,
    concurrency: "skip",
    allowedTools: ["Read", "Write"],
    allowedBashPrefixes: [],
    allowedMcpServers: [],
    outputDir: "/root/reports/demo",
    outputFilename: "{date}-demo.md",
    notifyOnComplete: true,
    notifyOnError: true,
    prompt: "do the thing",
    ...overrides,
  };
}

describe("validateCronExpression", () => {
  it("accepts a standard 5-field expression", () => {
    expect(validateCronExpression("0 6 * * *")).toBeNull();
    expect(validateCronExpression("*/5 * * * 1-5")).toBeNull();
  });
  it("rejects @-expressions", () => {
    expect(validateCronExpression("@daily")).toContain("@-aliases");
  });
  it("rejects 6-field expressions", () => {
    expect(validateCronExpression("*/30 * * * * *")).toContain("6-field");
  });
  it("rejects empty", () => {
    expect(validateCronExpression("")).toContain("required");
  });
  it("rejects malformed", () => {
    expect(validateCronExpression("not a cron")).toBeTruthy();
  });
});

describe("validateJob", () => {
  it("returns no errors for a valid job", () => {
    expect(validateJob(baseJob())).toEqual([]);
  });

  it("rejects bad slugs", () => {
    const errs = validateJob(baseJob({ id: "UPPER", slug: "UPPER" }));
    expect(errs.some((e) => e.field === "id")).toBe(true);
  });

  it("rejects mismatched slug/id", () => {
    const errs = validateJob(baseJob({ id: "demo", slug: "other" }));
    expect(errs.some((e) => e.field === "slug")).toBe(true);
  });

  it("rejects human-required tools", () => {
    const errs = validateJob(baseJob({ allowedTools: ["Read", "AskUserQuestion"] }));
    expect(
      errs.some((e) => e.field === "allowedTools" && e.message.includes("AskUserQuestion")),
    ).toBe(true);
  });

  it("rejects unknown tools", () => {
    const errs = validateJob(baseJob({ allowedTools: ["Readd"] }));
    expect(errs.some((e) => e.field === "allowedTools")).toBe(true);
  });

  it("rejects outputDir outside /root/reports", () => {
    const errs = validateJob(baseJob({ outputDir: "/etc" }));
    expect(errs.some((e) => e.field === "outputDir")).toBe(true);
  });

  it("rejects excessive maxTurns", () => {
    expect(validateJob(baseJob({ maxTurns: 0 })).some((e) => e.field === "maxTurns")).toBe(true);
    expect(validateJob(baseJob({ maxTurns: 501 })).some((e) => e.field === "maxTurns")).toBe(true);
  });

  it("rejects oversize bash prefixes", () => {
    const errs = validateJob(baseJob({ allowedBashPrefixes: ["x".repeat(201)] }));
    expect(errs.some((e) => e.field === "allowedBashPrefixes")).toBe(true);
  });
});
