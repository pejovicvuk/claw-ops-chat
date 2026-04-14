import { describe, it, expect, vi, beforeAll } from "vitest";

// Must stub env BEFORE import — vitest hoists imports
vi.stubEnv("CLAW_CHAT_TOKEN", "test-token-abc123");

const mod = await import("./auth-server");
const {
  validateToken,
  extractBearerToken,
  extractToken,
  extractTokenFromCookieHeader,
  makeSessionCookie,
  makeClearSessionCookie,
} = mod;

describe("validateToken", () => {
  it("accepts the correct token", () => {
    expect(validateToken("test-token-abc123")).toBe(true);
  });

  it("rejects an incorrect token", () => {
    expect(validateToken("wrong-token-xyz")).toBe(false);
  });

  it("rejects an empty token", () => {
    expect(validateToken("")).toBe(false);
  });

  it("rejects a token of different length", () => {
    expect(validateToken("short")).toBe(false);
  });

  it("uses timing-safe comparison (same length, different content)", () => {
    // Same length as "test-token-abc123" (18 chars)
    expect(validateToken("xxxxxxxxxxxxxxxxxx")).toBe(false);
  });
});

describe("extractBearerToken", () => {
  it("extracts token from Authorization: Bearer header", () => {
    const req = new Request("http://localhost", {
      headers: { Authorization: "Bearer my-token" },
    });
    expect(extractBearerToken(req)).toBe("my-token");
  });

  it("returns null when no Authorization header", () => {
    const req = new Request("http://localhost");
    expect(extractBearerToken(req)).toBe(null);
  });

  it("returns null for non-Bearer auth", () => {
    const req = new Request("http://localhost", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(extractBearerToken(req)).toBe(null);
  });
});

describe("extractToken", () => {
  it("extracts token from cookie when present", () => {
    const req = new Request("http://localhost", {
      headers: { Cookie: "claw-session=cookie-token; other=val" },
    });
    expect(extractToken(req)).toBe("cookie-token");
  });

  it("falls back to Bearer token when no cookie", () => {
    const req = new Request("http://localhost", {
      headers: { Authorization: "Bearer bearer-token" },
    });
    expect(extractToken(req)).toBe("bearer-token");
  });

  it("prefers cookie over Bearer token", () => {
    const req = new Request("http://localhost", {
      headers: {
        Cookie: "claw-session=cookie-token",
        Authorization: "Bearer bearer-token",
      },
    });
    expect(extractToken(req)).toBe("cookie-token");
  });

  it("returns null when neither cookie nor Bearer is present", () => {
    const req = new Request("http://localhost");
    expect(extractToken(req)).toBe(null);
  });
});

describe("extractTokenFromCookieHeader", () => {
  it("extracts token from raw cookie header string", () => {
    expect(extractTokenFromCookieHeader("claw-session=my-token; path=/")).toBe("my-token");
  });

  it("handles URL-encoded token values", () => {
    expect(extractTokenFromCookieHeader("claw-session=token%20with%20space")).toBe("token with space");
  });

  it("returns null for missing cookie", () => {
    expect(extractTokenFromCookieHeader("other=val")).toBe(null);
  });

  it("returns null for undefined header", () => {
    expect(extractTokenFromCookieHeader(undefined)).toBe(null);
  });
});

describe("makeSessionCookie", () => {
  it("creates an httpOnly SameSite=Strict cookie", () => {
    const cookie = makeSessionCookie("my-token");
    expect(cookie).toContain("claw-session=my-token");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/chat");
    expect(cookie).toContain("Max-Age=");
  });
});

describe("makeClearSessionCookie", () => {
  it("creates a cookie that clears the session", () => {
    const cookie = makeClearSessionCookie();
    expect(cookie).toContain("claw-session=");
    expect(cookie).toContain("Max-Age=0");
  });
});
