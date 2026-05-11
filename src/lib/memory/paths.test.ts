import { describe, expect, it } from "vitest";

import { consolidatorProjectDirName, sanitizeCwdForClaude } from "./paths";

describe("sanitizeCwdForClaude", () => {
  it("matches the SDK's encoding for a plain project cwd", () => {
    expect(sanitizeCwdForClaude("/root/projects/test/claw-ops-chat")).toBe(
      "-root-projects-test-claw-ops-chat",
    );
  });

  it("encodes dot-prefixed segments as double dashes (verified live)", () => {
    // Disk truth: /root/.claude/projects/-root--memory--consolidator-cwd/
    expect(sanitizeCwdForClaude("/root/.memory/.consolidator-cwd")).toBe(
      "-root--memory--consolidator-cwd",
    );
  });

  it("preserves existing hyphens", () => {
    expect(sanitizeCwdForClaude("/a-b/c-d-e")).toBe("-a-b-c-d-e");
  });

  it("encodes root as a single dash", () => {
    expect(sanitizeCwdForClaude("/")).toBe("-");
  });
});

describe("consolidatorProjectDirName", () => {
  it("returns the exact dir name the SDK writes the consolidator's stub into", () => {
    // Tied to MEMORY_ROOT default. Failing this test means the boot
    // sweep + per-run cleanup + sidebar filter have all silently
    // diverged from the SDK's actual write path.
    expect(consolidatorProjectDirName()).toBe("-root--memory--consolidator-cwd");
  });
});
