import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let memRoot: string;

beforeEach(async () => {
  memRoot = await mkdtemp(join(tmpdir(), "consolidator-"));
  vi.resetModules();
  process.env.MEMORY_ROOT = memRoot;
  delete process.env.AUTO_GLOBAL_MEMORY;
});

afterEach(async () => {
  delete process.env.MEMORY_ROOT;
  delete process.env.AUTO_GLOBAL_MEMORY;
  await rm(memRoot, { recursive: true, force: true });
});

const SAMPLE_TRANSCRIPT_JSONL = [
  JSON.stringify({ type: "user", message: { role: "user", content: "I'm based in Belgrade." } }),
  JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Got it — Belgrade." }],
    },
  }),
  JSON.stringify({ type: "tool_result", message: { role: "user", content: "tool junk" } }),
  JSON.stringify({
    type: "user",
    message: { role: "user", content: "I prefer kebab-case file names." },
  }),
].join("\n");

describe("summarizeTranscript", () => {
  it("extracts user/assistant turns and drops tool messages", async () => {
    const { summarizeTranscript } = await import("./consolidator");
    const out = summarizeTranscript(SAMPLE_TRANSCRIPT_JSONL);
    expect(out).toContain("USER: I'm based in Belgrade.");
    expect(out).toContain("ASSISTANT: Got it — Belgrade.");
    expect(out).toContain("USER: I prefer kebab-case file names.");
    expect(out).not.toContain("tool junk");
  });

  it("flattens multi-block assistant content into joined text", async () => {
    const { summarizeTranscript } = await import("./consolidator");
    const jsonl = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Hello." },
          { type: "tool_use", id: "x", name: "Bash", input: {} },
          { type: "text", text: "Done." },
        ],
      },
    });
    expect(summarizeTranscript(jsonl)).toBe("ASSISTANT: Hello.\nDone.");
  });

  it("tail-trims to maxChars and realigns to a turn boundary", async () => {
    const { summarizeTranscript } = await import("./consolidator");
    const big = Array.from({ length: 200 }, (_, i) =>
      JSON.stringify({
        type: "user",
        message: { role: "user", content: `message ${i} ` + "x".repeat(80) },
      }),
    ).join("\n");
    const out = summarizeTranscript(big, 1000);
    expect(out.length).toBeLessThanOrEqual(1000);
    expect(out.startsWith("USER:")).toBe(true);
  });

  it("returns '' for empty / corrupt input", async () => {
    const { summarizeTranscript } = await import("./consolidator");
    expect(summarizeTranscript("")).toBe("");
    expect(summarizeTranscript("not json\n{also not json")).toBe("");
  });
});

describe("parseConsolidatorResponse", () => {
  it("parses a clean JSON object", async () => {
    const { parseConsolidatorResponse } = await import("./consolidator");
    const out = parseConsolidatorResponse(`{"add": ["User is in Belgrade."], "remove": []}`);
    expect(out).toEqual({ add: ["User is in Belgrade."], remove: [] });
  });

  it("strips markdown code fences", async () => {
    const { parseConsolidatorResponse } = await import("./consolidator");
    const out = parseConsolidatorResponse('```json\n{"add": ["x"], "remove": []}\n```');
    expect(out).toEqual({ add: ["x"], remove: [] });
  });

  it("returns null when the model says null", async () => {
    const { parseConsolidatorResponse } = await import("./consolidator");
    expect(parseConsolidatorResponse("null")).toBeNull();
    expect(parseConsolidatorResponse("  null  ")).toBeNull();
  });

  it("returns null on garbage", async () => {
    const { parseConsolidatorResponse } = await import("./consolidator");
    expect(parseConsolidatorResponse("not json")).toBeNull();
    expect(parseConsolidatorResponse("[]")).toBeNull();
    expect(parseConsolidatorResponse("")).toBeNull();
  });

  it("returns null when both add and remove are empty", async () => {
    const { parseConsolidatorResponse } = await import("./consolidator");
    expect(parseConsolidatorResponse(`{"add": [], "remove": []}`)).toBeNull();
  });

  it("filters non-string entries from arrays", async () => {
    const { parseConsolidatorResponse } = await import("./consolidator");
    const out = parseConsolidatorResponse(`{"add": ["good", 42, null], "remove": ["a", false]}`);
    expect(out).toEqual({ add: ["good"], remove: ["a"] });
  });
});

describe("runConsolidator", () => {
  it("no-ops when the toggle is off", async () => {
    const { runConsolidator, setConsolidatorLlm, resetConsolidatorLlm } =
      await import("./consolidator");
    const { updateAutoMemoryConfig } = await import("./auto-config");
    await updateAutoMemoryConfig({ enabled: false });

    let called = false;
    setConsolidatorLlm(async () => {
      called = true;
      return "{}";
    });

    const transcriptPath = join(memRoot, "fake-transcript.jsonl");
    await writeFile(transcriptPath, SAMPLE_TRANSCRIPT_JSONL, "utf-8");
    const outcome = await runConsolidator(transcriptPath);

    expect(outcome.ran).toBe(false);
    expect(called).toBe(false);
    resetConsolidatorLlm();
  });

  it("returns transcript-missing when the file is absent", async () => {
    const { runConsolidator } = await import("./consolidator");
    const outcome = await runConsolidator(join(memRoot, "no-such.jsonl"));
    expect(outcome.ran).toBe(false);
    expect(outcome.error).toBe("transcript-missing");
  });

  it("applies a parsed diff and writes auto.md", async () => {
    const { runConsolidator, setConsolidatorLlm, resetConsolidatorLlm } =
      await import("./consolidator");
    const { autoMemoryPath } = await import("./paths");

    setConsolidatorLlm(async (system, user) => {
      expect(system).toContain("STABLE, USER-LEVEL facts");
      expect(user).toContain("CONVERSATION:");
      return `{"add": ["User is based in Belgrade.", "User prefers TypeScript strict mode."], "remove": []}`;
    });

    const transcriptPath = join(memRoot, "fake-transcript.jsonl");
    await writeFile(transcriptPath, SAMPLE_TRANSCRIPT_JSONL, "utf-8");

    const outcome = await runConsolidator(transcriptPath);
    expect(outcome.ran).toBe(true);
    expect(outcome.added).toBe(2);
    expect(outcome.removed).toBe(0);

    const written = await readFile(autoMemoryPath(), "utf-8");
    expect(written).toContain("# Auto-collected memory");
    expect(written).toContain("User is based in Belgrade.");
    expect(written).toContain("User prefers TypeScript strict mode.");
    resetConsolidatorLlm();
  });

  it("records lastConsolidatedAt even when the diff is null", async () => {
    const { runConsolidator, setConsolidatorLlm, resetConsolidatorLlm } =
      await import("./consolidator");
    const { loadAutoMemoryConfig } = await import("./auto-config");

    setConsolidatorLlm(async () => "null");
    const transcriptPath = join(memRoot, "fake.jsonl");
    await writeFile(transcriptPath, SAMPLE_TRANSCRIPT_JSONL, "utf-8");

    const before = (await loadAutoMemoryConfig()).lastConsolidatedAt;
    await runConsolidator(transcriptPath);
    const after = (await loadAutoMemoryConfig()).lastConsolidatedAt;

    expect(before).toBeNull();
    expect(after).not.toBeNull();
    resetConsolidatorLlm();
  });

  it("returns error outcome (without crashing) when the LLM throws", async () => {
    const { runConsolidator, setConsolidatorLlm, resetConsolidatorLlm } =
      await import("./consolidator");

    setConsolidatorLlm(async () => {
      throw new Error("network down");
    });
    const transcriptPath = join(memRoot, "fake.jsonl");
    await writeFile(transcriptPath, SAMPLE_TRANSCRIPT_JSONL, "utf-8");

    const outcome = await runConsolidator(transcriptPath);
    expect(outcome.ran).toBe(true);
    expect(outcome.added).toBe(0);
    expect(outcome.error).toBe("network down");
    resetConsolidatorLlm();
  });
});

describe("ConsolidationScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces multiple schedule() calls into one runner invocation", async () => {
    const { ConsolidationScheduler } = await import("./consolidator");
    let calls = 0;
    const scheduler = new ConsolidationScheduler(async () => {
      calls += 1;
      return {
        ran: true,
        added: 0,
        removed: 0,
        rejected: 0,
        trimmed: false,
        totalBytes: 0,
      };
    });

    scheduler.schedule("s1", "/tmp/x.jsonl", 1000);
    scheduler.schedule("s1", "/tmp/x.jsonl", 1000);
    scheduler.schedule("s1", "/tmp/x.jsonl", 1000);
    expect(scheduler.pending()).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(1);
    expect(scheduler.pending()).toBe(0);
  });

  it("schedules different sessions independently", async () => {
    const { ConsolidationScheduler } = await import("./consolidator");
    const seen: string[] = [];
    const scheduler = new ConsolidationScheduler(async (path) => {
      seen.push(path);
      return {
        ran: true,
        added: 0,
        removed: 0,
        rejected: 0,
        trimmed: false,
        totalBytes: 0,
      };
    });

    scheduler.schedule("a", "/tmp/a.jsonl", 1000);
    scheduler.schedule("b", "/tmp/b.jsonl", 1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(seen.sort()).toEqual(["/tmp/a.jsonl", "/tmp/b.jsonl"]);
  });

  it("cancel() stops a pending consolidation", async () => {
    const { ConsolidationScheduler } = await import("./consolidator");
    let calls = 0;
    const scheduler = new ConsolidationScheduler(async () => {
      calls += 1;
      return {
        ran: true,
        added: 0,
        removed: 0,
        rejected: 0,
        trimmed: false,
        totalBytes: 0,
      };
    });
    scheduler.schedule("a", "/tmp/a.jsonl", 1000);
    scheduler.cancel("a");
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toBe(0);
  });
});
