import { describe, expect, it } from "vitest";
import {
  PROJECT_SLUG_RE,
  slugifyDisplayName,
  validateDisplayName,
  validateRepoUrl,
} from "./validation";

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

describe("validateRepoUrl", () => {
  describe("github", () => {
    it("accepts a normal repo URL", () => {
      const r = validateRepoUrl("github", "https://github.com/anthropics/claude-code");
      expect(r.ok).toBe(true);
      expect(r.owner).toBe("anthropics");
      expect(r.repo).toBe("claude-code");
      expect(r.normalizedUrl).toBe("https://github.com/anthropics/claude-code.git");
    });

    it("accepts a .git suffix and strips it from the repo segment", () => {
      const r = validateRepoUrl("github", "https://github.com/owner/repo.git");
      expect(r.ok).toBe(true);
      expect(r.repo).toBe("repo");
      expect(r.normalizedUrl).toBe("https://github.com/owner/repo.git");
    });

    it("accepts uppercase hostname", () => {
      expect(validateRepoUrl("github", "https://GitHub.com/owner/repo").ok).toBe(true);
    });

    it("rejects ssh URLs", () => {
      expect(validateRepoUrl("github", "git@github.com:owner/repo.git").ok).toBe(false);
      expect(validateRepoUrl("github", "ssh://git@github.com/owner/repo").ok).toBe(false);
    });

    it("rejects deep paths", () => {
      expect(validateRepoUrl("github", "https://github.com/owner/repo/tree/main").ok).toBe(false);
      expect(validateRepoUrl("github", "https://github.com/owner").ok).toBe(false);
    });

    it("rejects wrong hostname", () => {
      expect(validateRepoUrl("github", "https://gitlab.com/owner/repo").ok).toBe(false);
      expect(validateRepoUrl("github", "https://api.github.com/owner/repo").ok).toBe(false);
      expect(validateRepoUrl("github", "https://bitbucket.org/owner/repo").ok).toBe(false);
    });

    it("rejects non-https schemes", () => {
      expect(validateRepoUrl("github", "http://github.com/owner/repo").ok).toBe(false);
      expect(validateRepoUrl("github", "file:///etc/passwd").ok).toBe(false);
    });

    it("rejects query strings, fragments, ports, credentials", () => {
      expect(validateRepoUrl("github", "https://github.com/owner/repo?x=1").ok).toBe(false);
      expect(validateRepoUrl("github", "https://github.com/owner/repo#frag").ok).toBe(false);
      expect(validateRepoUrl("github", "https://github.com:8080/owner/repo").ok).toBe(false);
      expect(validateRepoUrl("github", "https://user:pass@github.com/owner/repo").ok).toBe(false);
    });

    it("rejects empty / whitespace / malformed input", () => {
      expect(validateRepoUrl("github", "").ok).toBe(false);
      expect(validateRepoUrl("github", "   ").ok).toBe(false);
      expect(validateRepoUrl("github", "not a url").ok).toBe(false);
      expect(validateRepoUrl("github", undefined).ok).toBe(false);
      expect(validateRepoUrl("github", 42).ok).toBe(false);
    });

    it("rejects owner/repo segments with weird characters", () => {
      expect(validateRepoUrl("github", "https://github.com/own er/repo").ok).toBe(false);
      expect(validateRepoUrl("github", "https://github.com/owner/repo;rm").ok).toBe(false);
      expect(validateRepoUrl("github", "https://github.com/./repo").ok).toBe(false);
      expect(validateRepoUrl("github", "https://github.com/../repo").ok).toBe(false);
    });

    it("trims surrounding whitespace before parsing", () => {
      expect(validateRepoUrl("github", "  https://github.com/owner/repo  ").ok).toBe(true);
    });
  });

  describe("bitbucket", () => {
    it("accepts a normal workspace/repo URL", () => {
      const r = validateRepoUrl("bitbucket", "https://bitbucket.org/myws/myrepo");
      expect(r.ok).toBe(true);
      expect(r.owner).toBe("myws");
      expect(r.repo).toBe("myrepo");
      expect(r.normalizedUrl).toBe("https://bitbucket.org/myws/myrepo.git");
    });

    it("rejects github URLs", () => {
      expect(validateRepoUrl("bitbucket", "https://github.com/owner/repo").ok).toBe(false);
    });
  });
});
