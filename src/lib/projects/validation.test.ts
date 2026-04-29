import { describe, expect, it } from "vitest";
import { PROJECT_SLUG_RE, slugifyDisplayName, validateDisplayName } from "./validation";

describe("slugifyDisplayName", () => {
  const cases: Array<[string, string]> = [
    ["My Project", "my-project"],
    ["  hello  ", "hello"],
    ["My Cool Project!!!", "my-cool-project"],
    ["___underscores___", "underscores"],
    ["multiple   spaces", "multiple-spaces"],
    ["UPPER", "upper"],
    ["leading---dashes", "leading-dashes"],
    ["a".repeat(80), "a".repeat(64)],
    ["café", "caf"],
    ["123 numbers", "123-numbers"],
  ];
  for (const [input, expected] of cases) {
    it(`maps ${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
      expect(slugifyDisplayName(input)).toBe(expected);
    });
  }

  it("returns empty string when nothing alphanumeric survives", () => {
    expect(slugifyDisplayName("...!!!")).toBe("");
    expect(slugifyDisplayName("  ")).toBe("");
  });
});

describe("PROJECT_SLUG_RE", () => {
  const accepted = ["a", "abc", "my-project", "a1", "1a", "a".repeat(64)];
  const rejected = [
    "",
    "..",
    "../escape",
    "foo/bar",
    "foo\\bar",
    "-leading",
    "Trailing-",
    "UPPER",
    "with space",
    "a".repeat(65),
    ".hidden",
  ];
  for (const ok of accepted) {
    it(`accepts ${JSON.stringify(ok)}`, () => {
      expect(PROJECT_SLUG_RE.test(ok)).toBe(true);
    });
  }
  for (const bad of rejected) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      expect(PROJECT_SLUG_RE.test(bad)).toBe(false);
    });
  }
});

describe("validateDisplayName", () => {
  it("accepts a normal name and returns the slug", () => {
    const result = validateDisplayName("My Project");
    expect(result.ok).toBe(true);
    expect(result.slug).toBe("my-project");
  });

  it("trims surrounding whitespace before validating", () => {
    const result = validateDisplayName("  Hello World  ");
    expect(result.ok).toBe(true);
    expect(result.slug).toBe("hello-world");
  });

  it("rejects non-string input", () => {
    expect(validateDisplayName(undefined).ok).toBe(false);
    expect(validateDisplayName(null).ok).toBe(false);
    expect(validateDisplayName(42).ok).toBe(false);
  });

  it("rejects empty / whitespace-only", () => {
    expect(validateDisplayName("").ok).toBe(false);
    expect(validateDisplayName("    ").ok).toBe(false);
  });

  it("rejects names longer than 64 chars after trim", () => {
    expect(validateDisplayName("x".repeat(65)).ok).toBe(false);
    expect(validateDisplayName("x".repeat(64)).ok).toBe(true);
  });

  it("rejects path separators", () => {
    expect(validateDisplayName("foo/bar").ok).toBe(false);
    expect(validateDisplayName("foo\\bar").ok).toBe(false);
  });

  it("rejects control characters", () => {
    expect(validateDisplayName("foo\nbar").ok).toBe(false);
    expect(validateDisplayName("foo\tbar").ok).toBe(false);
    expect(validateDisplayName("foo\x00bar").ok).toBe(false);
  });

  it("rejects names that slugify to nothing", () => {
    expect(validateDisplayName("...!!!").ok).toBe(false);
    expect(validateDisplayName("---").ok).toBe(false);
  });
});
