import { describe, expect, it } from "vitest";

import { MAX_FILE_BYTES, MAX_TOTAL_BYTES } from "./paths";
import { MemoryValidationError, assertMemoryRelPath, validateMemoryContent } from "./validation";

describe("assertMemoryRelPath", () => {
  it("accepts a flat .md filename", () => {
    expect(() => assertMemoryRelPath("notes.md")).not.toThrow();
  });

  it("accepts nested .md paths", () => {
    expect(() => assertMemoryRelPath("progress/today.md")).not.toThrow();
    expect(() => assertMemoryRelPath("a/b/c.md")).not.toThrow();
  });

  it("accepts hyphens, underscores, digits", () => {
    expect(() => assertMemoryRelPath("my-rule_2.md")).not.toThrow();
  });

  it("rejects path traversal", () => {
    expect(() => assertMemoryRelPath("../etc/passwd.md")).toThrow(MemoryValidationError);
    expect(() => assertMemoryRelPath("a/../b.md")).toThrow(MemoryValidationError);
  });

  it("rejects absolute paths", () => {
    expect(() => assertMemoryRelPath("/etc/passwd.md")).toThrow(MemoryValidationError);
  });

  it("rejects null bytes", () => {
    expect(() => assertMemoryRelPath("a\0b.md")).toThrow(MemoryValidationError);
  });

  it("rejects dotfiles", () => {
    expect(() => assertMemoryRelPath(".hidden.md")).toThrow(MemoryValidationError);
    expect(() => assertMemoryRelPath("sub/.hidden.md")).toThrow(MemoryValidationError);
  });

  it("rejects non-.md suffixes", () => {
    expect(() => assertMemoryRelPath("notes.txt")).toThrow(MemoryValidationError);
    expect(() => assertMemoryRelPath("notes")).toThrow(MemoryValidationError);
  });

  it("rejects backslashes (Windows separator)", () => {
    expect(() => assertMemoryRelPath("a\\b.md")).toThrow(MemoryValidationError);
  });

  it("rejects uppercase", () => {
    expect(() => assertMemoryRelPath("NOTES.md")).toThrow(MemoryValidationError);
  });

  it("rejects empty and overlong", () => {
    expect(() => assertMemoryRelPath("")).toThrow(MemoryValidationError);
    expect(() => assertMemoryRelPath("a".repeat(300) + ".md")).toThrow(MemoryValidationError);
  });

  it("rejects non-strings", () => {
    expect(() => assertMemoryRelPath(123)).toThrow(MemoryValidationError);
    expect(() => assertMemoryRelPath(null)).toThrow(MemoryValidationError);
  });
});

describe("validateMemoryContent", () => {
  it("accepts content under both caps", () => {
    expect(validateMemoryContent("hello", 0).ok).toBe(true);
  });

  it("rejects content over the per-file cap", () => {
    const big = "x".repeat(MAX_FILE_BYTES + 1);
    const result = validateMemoryContent(big, 0);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(413);
    expect(result.error).toContain("per-file");
  });

  it("rejects writes that would push the scope over the total cap", () => {
    const result = validateMemoryContent("x".repeat(2000), MAX_TOTAL_BYTES - 1000);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(413);
    expect(result.error).toContain("total");
  });

  it("uses byte length, not character length, for caps", () => {
    // 4-byte emoji counts as 4 bytes.
    const emoji = "💾".repeat(MAX_FILE_BYTES / 4);
    expect(validateMemoryContent(emoji, 0).ok).toBe(true);
    const tooMany = emoji + "💾";
    expect(validateMemoryContent(tooMany, 0).ok).toBe(false);
  });
});
