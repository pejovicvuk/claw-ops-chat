import { describe, expect, it } from "vitest";
import { decideCronTool } from "./tool-policy";

function policy(overrides: Partial<Parameters<typeof decideCronTool>[0]> = {}) {
  return {
    kind: "cron" as const,
    allowed: ["Read", "Write"],
    allowedBashPrefixes: [],
    turnBudget: { remaining: 10 },
    denials: [] as string[],
    ...overrides,
  };
}

describe("decideCronTool", () => {
  it("allows whitelisted tools and decrements the budget", () => {
    const p = policy();
    const decision = decideCronTool(p, "Read", { file_path: "/tmp/x" });
    expect(decision.behavior).toBe("allow");
    expect(p.turnBudget.remaining).toBe(9);
  });

  it("denies tools not in the allowlist", () => {
    const p = policy();
    const decision = decideCronTool(p, "Bash", { command: "ls" });
    expect(decision.behavior).toBe("deny");
    expect(p.denials).toContain("Bash(ls)");
  });

  it("denies AskUserQuestion unconditionally", () => {
    const p = policy({ allowed: ["Read", "AskUserQuestion"] });
    const decision = decideCronTool(p, "AskUserQuestion", {});
    expect(decision.behavior).toBe("deny");
    expect(decision.message).toContain("no human");
  });

  it("denies ExitPlanMode unconditionally", () => {
    const p = policy({ allowed: ["Read", "ExitPlanMode"] });
    expect(decideCronTool(p, "ExitPlanMode", {}).behavior).toBe("deny");
  });

  it("denies when turn budget is exhausted", () => {
    const p = policy({ turnBudget: { remaining: 0 } });
    expect(decideCronTool(p, "Read", {}).behavior).toBe("deny");
  });

  it("allows Bash only if command matches an allowedBashPrefix", () => {
    const p = policy({ allowed: ["Bash"], allowedBashPrefixes: ["git status", "ls"] });
    expect(decideCronTool(p, "Bash", { command: "git status" }).behavior).toBe("allow");
    expect(decideCronTool(p, "Bash", { command: "rm -rf /" }).behavior).toBe("deny");
  });

  it("denies Bash when allowedBashPrefixes is empty even if Bash is in allowedTools", () => {
    const p = policy({ allowed: ["Bash"], allowedBashPrefixes: [] });
    expect(decideCronTool(p, "Bash", { command: "ls" }).behavior).toBe("deny");
  });

  it("handles mcp__server__* wildcards", () => {
    const p = policy({ allowed: ["mcp__gmail__*"] });
    expect(decideCronTool(p, "mcp__gmail__send_message", { to: "x" }).behavior).toBe("allow");
    expect(decideCronTool(p, "mcp__other__send_message", {}).behavior).toBe("deny");
  });
});
