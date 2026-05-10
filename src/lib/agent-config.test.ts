import { mkdtempSync, rmSync } from "fs";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AgentConfigError,
  createRule,
  createSkill,
  createSubagent,
  deleteRule,
  deleteSkill,
  deleteSubagent,
  deleteSystemPromptAppend,
  getCustomAppendForSdk,
  listRules,
  listSkills,
  listSubagents,
  loadSystemPromptAppend,
  makePreview,
  parseFrontmatterField,
  readRule,
  readSkill,
  readSubagent,
  saveSystemPromptAppend,
  updateRule,
  updateSkill,
  updateSubagent,
  __test__,
  MAX_CONTENT_BYTES,
} from "./agent-config";

let workDir = "";
const originalCwd = process.env.CLAUDE_CWD;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "agent-config-test-"));
  process.env.CLAUDE_CWD = workDir;
});

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
  if (originalCwd === undefined) delete process.env.CLAUDE_CWD;
  else process.env.CLAUDE_CWD = originalCwd;
});

describe("NAME_REGEX / assertValidName", () => {
  it("accepts kebab-case and digits", () => {
    expect(() => __test__.assertValidName("lowercase-rule")).not.toThrow();
    expect(() => __test__.assertValidName("rule-123")).not.toThrow();
    expect(() => __test__.assertValidName("a")).not.toThrow();
  });

  it("rejects path traversal attempts", () => {
    expect(() => __test__.assertValidName("../evil")).toThrow(AgentConfigError);
    expect(() => __test__.assertValidName("foo/bar")).toThrow(AgentConfigError);
    expect(() => __test__.assertValidName("..")).toThrow(AgentConfigError);
    expect(() => __test__.assertValidName("")).toThrow(AgentConfigError);
  });

  it("rejects leading dash, dot, or uppercase", () => {
    expect(() => __test__.assertValidName("-leading")).toThrow(AgentConfigError);
    expect(() => __test__.assertValidName(".hidden")).toThrow(AgentConfigError);
    expect(() => __test__.assertValidName("UPPER")).toThrow(AgentConfigError);
  });

  it("rejects names over 64 chars", () => {
    expect(() => __test__.assertValidName("a".repeat(65))).toThrow(AgentConfigError);
  });
});

describe("system prompt", () => {
  it("returns empty record before first save", async () => {
    const rec = await loadSystemPromptAppend();
    expect(rec.prompt).toBe("");
    expect(rec.updatedAt).toBeNull();
  });

  it("round-trips a saved prompt with mtimeMs", async () => {
    await saveSystemPromptAppend("You are on a Linux server.");
    const rec = await loadSystemPromptAppend();
    expect(rec.prompt).toBe("You are on a Linux server.");
    expect(rec.updatedAt).toBeTypeOf("number");
  });

  it("clears the file on delete", async () => {
    await saveSystemPromptAppend("hello");
    await deleteSystemPromptAppend();
    const rec = await loadSystemPromptAppend();
    expect(rec.prompt).toBe("");
    expect(rec.updatedAt).toBeNull();
  });

  it("rejects content over the size cap", async () => {
    const huge = "x".repeat(MAX_CONTENT_BYTES + 1);
    await expect(saveSystemPromptAppend(huge)).rejects.toMatchObject({
      status: 413,
    });
  });

  it("does not leave behind the .tmp file after atomic write", async () => {
    await saveSystemPromptAppend("hello");
    const entries = await readdir(join(workDir, ".claude"));
    expect(entries).toContain("custom-system-prompt.md");
    expect(entries.some((e) => e.endsWith(".tmp"))).toBe(false);
  });
});

describe("rules CRUD", () => {
  it("lists empty when no dir exists", async () => {
    expect(await listRules()).toEqual([]);
  });

  it("creates, reads, updates, deletes", async () => {
    await createRule("my-rule", "Be concise.");
    const list = await listRules();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("my-rule");
    expect(list[0].preview).toBe("Be concise.");

    const rec = await readRule("my-rule");
    expect(rec.content).toBe("Be concise.");

    await updateRule("my-rule", "Be very concise.");
    expect((await readRule("my-rule")).content).toBe("Be very concise.");

    await deleteRule("my-rule");
    expect(await listRules()).toEqual([]);
  });

  it("writes files into the rules directory", async () => {
    await createRule("placement", "x");
    const contents = await readFile(join(workDir, ".claude", "rules", "placement.md"), "utf-8");
    expect(contents).toBe("x");
  });

  it("rejects duplicate create", async () => {
    await createRule("dup", "a");
    await expect(createRule("dup", "b")).rejects.toMatchObject({ status: 409 });
  });

  it("rejects update of missing rule", async () => {
    await expect(updateRule("nope", "x")).rejects.toMatchObject({ status: 404 });
  });

  it("rejects read of missing rule", async () => {
    await expect(readRule("nope")).rejects.toMatchObject({ status: 404 });
  });

  it("rejects path-traversal names", async () => {
    await expect(createRule("../evil", "x")).rejects.toBeInstanceOf(AgentConfigError);
    await expect(createRule("a/b", "x")).rejects.toBeInstanceOf(AgentConfigError);
  });

  it("ignores non-markdown files when listing", async () => {
    await createRule("real", "content");
    // Drop a bogus file into the dir directly
    const { writeFile } = await import("fs/promises");
    await writeFile(join(workDir, ".claude", "rules", "README.txt"), "nope", "utf-8");
    const list = await listRules();
    expect(list.map((r) => r.name)).toEqual(["real"]);
  });
});

describe("subagents CRUD", () => {
  it("parses description from frontmatter", async () => {
    const content =
      "---\nname: reviewer\ndescription: Reviews code changes\n---\n\nBody goes here.";
    await createSubagent("reviewer", content);
    const list = await listSubagents();
    expect(list[0].description).toBe("Reviews code changes");
    expect(list[0].preview).toBe("Body goes here.");
  });

  it("round-trips content through read/update", async () => {
    await createSubagent("bot", "hello");
    expect((await readSubagent("bot")).content).toBe("hello");
    await updateSubagent("bot", "world");
    expect((await readSubagent("bot")).content).toBe("world");
    await deleteSubagent("bot");
    expect(await listSubagents()).toEqual([]);
  });
});

describe("skills CRUD", () => {
  it("stores SKILL.md inside a per-skill directory", async () => {
    await createSkill("deploy", "---\nname: deploy\n---\n\nhow to deploy");
    const list = await listSkills();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("deploy");

    const contents = await readFile(
      join(workDir, ".claude", "skills", "deploy", "SKILL.md"),
      "utf-8",
    );
    expect(contents).toContain("how to deploy");
  });

  it("round-trips content and frontmatter description", async () => {
    await createSkill("build", "---\ndescription: Build it\n---\n\nbody");
    const list = await listSkills();
    expect(list[0].description).toBe("Build it");
    expect((await readSkill("build")).content).toContain("body");

    await updateSkill("build", "---\ndescription: Updated\n---\n\nbody2");
    expect((await listSkills())[0].description).toBe("Updated");
  });

  it("removes the whole skill directory on delete", async () => {
    await createSkill("throwaway", "x");
    await deleteSkill("throwaway");
    const { existsSync } = await import("fs");
    expect(existsSync(join(workDir, ".claude", "skills", "throwaway"))).toBe(false);
  });

  it("rejects path traversal via skill name", async () => {
    await expect(createSkill("..", "x")).rejects.toBeInstanceOf(AgentConfigError);
    await expect(createSkill("../escape", "x")).rejects.toBeInstanceOf(AgentConfigError);
  });
});

describe("getCustomAppendForSdk", () => {
  // Phase 2: legacy system-prompt + rules content has been migrated into
  // /root/.memory/global/ and is now surfaced by getGlobalMemoryAppend()
  // in src/lib/memory/global-injector.ts. This function is intentionally
  // a no-op — kept only so the call site in server.ts doesn't churn.
  it("always returns an empty string", async () => {
    expect(await getCustomAppendForSdk()).toBe("");
    await saveSystemPromptAppend("Be kind.");
    await createRule("tone", "Be formal.");
    expect(await getCustomAppendForSdk()).toBe("");
  });
});

describe("makePreview", () => {
  it("strips frontmatter before collapsing whitespace", () => {
    const input = "---\nname: foo\n---\n\nHello\n  world   from    there";
    expect(makePreview(input)).toBe("Hello world from there");
  });

  it("truncates with ellipsis past the limit", () => {
    expect(makePreview("a".repeat(500), 10)).toBe("aaaaaaaaa…");
  });
});

describe("parseFrontmatterField", () => {
  it("reads a plain field", () => {
    const input = "---\nname: foo\ndescription: bar baz\n---\nbody";
    expect(parseFrontmatterField(input, "name")).toBe("foo");
    expect(parseFrontmatterField(input, "description")).toBe("bar baz");
  });

  it("strips surrounding quotes", () => {
    const input = `---\ndescription: "quoted value"\n---\nbody`;
    expect(parseFrontmatterField(input, "description")).toBe("quoted value");
  });

  it("returns undefined when frontmatter is missing", () => {
    expect(parseFrontmatterField("no frontmatter here", "name")).toBeUndefined();
  });

  it("returns undefined for missing field", () => {
    expect(parseFrontmatterField("---\nname: x\n---\nbody", "missing")).toBeUndefined();
  });
});
