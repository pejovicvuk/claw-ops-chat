import { describe, expect, it } from "vitest";
import { JOB_DEFAULTS, parseJobMarkdown, serializeJobMarkdown } from "./job-parser";
import type { ReportJob } from "./types";

const MINIMAL = `---
id: demo
name: Demo job
schedule: "0 6 * * *"
timezone: UTC
allowedTools: [Read]
---

# Prompt body
hello`;

describe("parseJobMarkdown", () => {
  it("parses a minimal job and applies sensible defaults", () => {
    const { job } = parseJobMarkdown(MINIMAL);
    expect(job.id).toBe("demo");
    expect(job.name).toBe("Demo job");
    expect(job.schedule).toBe("0 6 * * *");
    expect(job.timezone).toBe("UTC");
    expect(job.allowedTools).toEqual(["Read"]);
    expect(job.maxTurns).toBe(JOB_DEFAULTS.maxTurns);
    expect(job.concurrency).toBe(JOB_DEFAULTS.concurrency);
    expect(job.outputDir).toBe("/root/reports/demo");
    expect(job.outputFilename).toBe("{date}-demo.md");
    expect(job.prompt).toBe("# Prompt body\nhello");
  });

  it("throws when id/slug is missing", () => {
    const bad = `---\nname: no id\n---\nbody`;
    expect(() => parseJobMarkdown(bad)).toThrow(/id/);
  });

  it("preserves unknown frontmatter keys", () => {
    const withExtras = `---\nid: demo\nname: X\nschedule: "* * * * *"\ntimezone: UTC\ncustomKey: 42\nanother: [a, b]\n---\nbody`;
    const { unknownFrontmatter } = parseJobMarkdown(withExtras);
    expect(unknownFrontmatter.customKey).toBe(42);
    expect(unknownFrontmatter.another).toEqual(["a", "b"]);
  });

  it("rejects invalid concurrency values by falling back to default", () => {
    const bad = `---\nid: demo\nname: X\nschedule: "* * * * *"\ntimezone: UTC\nconcurrency: exotic\n---\nbody`;
    const { job } = parseJobMarkdown(bad);
    expect(job.concurrency).toBe("skip");
  });
});

describe("serializeJobMarkdown", () => {
  it("round-trips without losing fields", () => {
    const { job, unknownFrontmatter } = parseJobMarkdown(MINIMAL);
    const serialized = serializeJobMarkdown(job, unknownFrontmatter);
    const { job: roundtripped } = parseJobMarkdown(serialized);
    expect(roundtripped).toEqual(job);
  });

  it("preserves unknown frontmatter on round trip", () => {
    const withExtras = `---\nid: demo\nname: X\nschedule: "* * * * *"\ntimezone: UTC\ncustomKey: hello\n---\nbody`;
    const parsed = parseJobMarkdown(withExtras);
    const serialized = serializeJobMarkdown(parsed.job, parsed.unknownFrontmatter);
    const reparsed = parseJobMarkdown(serialized);
    expect(reparsed.unknownFrontmatter.customKey).toBe("hello");
  });

  it("serializes empty prompt without crashing", () => {
    const job: ReportJob = {
      id: "x",
      slug: "x",
      name: "X",
      schedule: "* * * * *",
      timezone: "UTC",
      enabled: true,
      version: 1,
      maxTurns: 10,
      maxDurationSec: 60,
      concurrency: "skip",
      allowedTools: [],
      allowedBashPrefixes: [],
      allowedMcpServers: [],
      outputDir: "/root/reports/x",
      outputFilename: "{date}-x.md",
      notifyOnComplete: true,
      notifyOnError: true,
      prompt: "",
    };
    const str = serializeJobMarkdown(job);
    expect(str).toContain("id: x");
    expect(parseJobMarkdown(str).job.id).toBe("x");
  });
});
