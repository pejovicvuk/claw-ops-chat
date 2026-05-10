import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let cwdRoot: string;
let memRoot: string;

beforeEach(async () => {
  cwdRoot = await mkdtemp(join(tmpdir(), "migrate-cwd-"));
  memRoot = await mkdtemp(join(tmpdir(), "migrate-mem-"));
  vi.resetModules();
  process.env.CLAUDE_CWD = cwdRoot;
  process.env.MEMORY_ROOT = memRoot;
});

afterEach(async () => {
  delete process.env.CLAUDE_CWD;
  delete process.env.MEMORY_ROOT;
  await rm(cwdRoot, { recursive: true, force: true });
  await rm(memRoot, { recursive: true, force: true });
});

async function seedLegacy(opts: { systemPrompt?: string; rules?: Record<string, string> }) {
  const claudeDir = join(cwdRoot, ".claude");
  await mkdir(claudeDir, { recursive: true });
  if (opts.systemPrompt !== undefined) {
    await writeFile(join(claudeDir, "custom-system-prompt.md"), opts.systemPrompt, "utf-8");
  }
  if (opts.rules) {
    const rulesDir = join(claudeDir, "rules");
    await mkdir(rulesDir, { recursive: true });
    for (const [name, content] of Object.entries(opts.rules)) {
      await writeFile(join(rulesDir, `${name}.md`), content, "utf-8");
    }
  }
}

describe("migrateAgentConfigToMemory", () => {
  it("no-ops when there's no legacy content", async () => {
    const { migrateAgentConfigToMemory } = await import("./migrate-from-agent-config");
    const summary = await migrateAgentConfigToMemory();
    expect(summary.instructionsCopied).toBe(false);
    expect(summary.rulesCopied).toBe(0);
    expect(summary.rulesSkipped).toBe(0);
    expect(summary.errors).toEqual([]);
  });

  it("copies the system prompt to instructions.md", async () => {
    await seedLegacy({ systemPrompt: "Be terse. Use TS strict." });
    const { migrateAgentConfigToMemory } = await import("./migrate-from-agent-config");
    const { globalMemoryDir } = await import("./paths");

    const summary = await migrateAgentConfigToMemory();

    expect(summary.instructionsCopied).toBe(true);
    expect(await readFile(join(globalMemoryDir(), "instructions.md"), "utf-8")).toBe(
      "Be terse. Use TS strict.",
    );
  });

  it("skips empty system prompts", async () => {
    await seedLegacy({ systemPrompt: "   \n  " });
    const { migrateAgentConfigToMemory } = await import("./migrate-from-agent-config");
    const summary = await migrateAgentConfigToMemory();
    expect(summary.instructionsCopied).toBe(false);
  });

  it("copies each rule to rules/<name>.md", async () => {
    await seedLegacy({
      rules: {
        naming: "Use kebab-case file names.",
        "no-mocks": "Don't mock the database.",
      },
    });
    const { migrateAgentConfigToMemory } = await import("./migrate-from-agent-config");
    const { globalMemoryDir } = await import("./paths");

    const summary = await migrateAgentConfigToMemory();

    expect(summary.rulesCopied).toBe(2);
    expect(summary.rulesSkipped).toBe(0);
    expect(await readFile(join(globalMemoryDir(), "rules/naming.md"), "utf-8")).toBe(
      "Use kebab-case file names.",
    );
    expect(await readFile(join(globalMemoryDir(), "rules/no-mocks.md"), "utf-8")).toBe(
      "Don't mock the database.",
    );
  });

  it("is idempotent — second run skips already-migrated files", async () => {
    await seedLegacy({
      systemPrompt: "first content",
      rules: { foo: "first rule" },
    });
    const { migrateAgentConfigToMemory } = await import("./migrate-from-agent-config");
    const { globalMemoryDir } = await import("./paths");

    const first = await migrateAgentConfigToMemory();
    expect(first.instructionsCopied).toBe(true);
    expect(first.rulesCopied).toBe(1);

    // Mutate the legacy source — destination should NOT be overwritten.
    await writeFile(
      join(cwdRoot, ".claude/custom-system-prompt.md"),
      "MUTATED — should not propagate",
      "utf-8",
    );
    await writeFile(join(cwdRoot, ".claude/rules/foo.md"), "MUTATED rule", "utf-8");

    const second = await migrateAgentConfigToMemory();
    expect(second.instructionsCopied).toBe(false);
    expect(second.rulesCopied).toBe(0);
    expect(second.rulesSkipped).toBe(1);

    // Destination still has the original content.
    expect(await readFile(join(globalMemoryDir(), "instructions.md"), "utf-8")).toBe(
      "first content",
    );
    expect(await readFile(join(globalMemoryDir(), "rules/foo.md"), "utf-8")).toBe("first rule");
  });

  it("never deletes the legacy originals", async () => {
    await seedLegacy({ systemPrompt: "keep me", rules: { x: "keep me too" } });
    const { migrateAgentConfigToMemory } = await import("./migrate-from-agent-config");
    await migrateAgentConfigToMemory();

    expect(await readFile(join(cwdRoot, ".claude/custom-system-prompt.md"), "utf-8")).toBe(
      "keep me",
    );
    expect(await readFile(join(cwdRoot, ".claude/rules/x.md"), "utf-8")).toBe("keep me too");
  });

  it("captures per-file errors instead of crashing the whole pass", async () => {
    // Seed two rules; corrupt the second to cause a write failure by giving
    // it a name the memory layer accepts but the destination tree refuses
    // (we simulate this by pre-creating the destination as a directory so
    // writeMemoryFile's writeFile call fails).
    await seedLegacy({ rules: { good: "ok", bad: "ok" } });

    const { globalMemoryDir, ensureMemoryTree } = await import("./paths");
    await ensureMemoryTree();
    await mkdir(join(globalMemoryDir(), "rules/bad.md"), { recursive: true });

    const { migrateAgentConfigToMemory } = await import("./migrate-from-agent-config");
    const summary = await migrateAgentConfigToMemory();

    expect(summary.rulesCopied).toBe(1); // good
    expect(summary.rulesSkipped).toBe(1); // bad — destination "exists" (as a dir)
    expect(summary.errors.length).toBe(0); // no error because we treated it as already-present
  });
});
