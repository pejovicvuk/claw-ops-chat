import { describe, expect, it } from "vitest";
import { buildFindScript, escapeRegExp, normalizeQuery } from "../find-in-page";

describe("escapeRegExp", () => {
  it("returns plain alphanumerics unchanged", () => {
    expect(escapeRegExp("hello world")).toBe("hello world");
  });

  it("escapes every regex meta-character", () => {
    expect(escapeRegExp("a.b+c")).toBe("a\\.b\\+c");
    expect(escapeRegExp("(x|y)*")).toBe("\\(x\\|y\\)\\*");
    expect(escapeRegExp("[^abc]")).toBe("\\[\\^abc\\]");
    expect(escapeRegExp("\\d")).toBe("\\\\d");
  });

  it("handles empty input", () => {
    expect(escapeRegExp("")).toBe("");
  });
});

describe("normalizeQuery", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeQuery("  hello  ")).toBe("hello");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(normalizeQuery("   \t\n  ")).toBe("");
  });

  it("returns an empty string for non-string input", () => {
    expect(normalizeQuery(undefined as unknown as string)).toBe("");
    expect(normalizeQuery(null as unknown as string)).toBe("");
    expect(normalizeQuery(123 as unknown as string)).toBe("");
  });
});

describe("buildFindScript", () => {
  it("returns a non-empty IIFE that installs window.__clawFind", () => {
    const src = buildFindScript();
    expect(src.length).toBeGreaterThan(100);
    expect(src).toContain("window.__clawFind");
    expect(src).toContain("open(query)");
    expect(src).toContain("next()");
    expect(src).toContain("prev()");
    expect(src).toContain("close()");
  });

  it("is idempotent — installs only once via the early-return guard", () => {
    const src = buildFindScript();
    expect(src).toMatch(/if\s*\(\s*window\.__clawFind\s*\)\s*return/);
  });

  it("skips inert tags so script/style content is never highlighted", () => {
    const src = buildFindScript();
    expect(src).toContain("SCRIPT");
    expect(src).toContain("STYLE");
    expect(src).toContain("NOSCRIPT");
  });
});
