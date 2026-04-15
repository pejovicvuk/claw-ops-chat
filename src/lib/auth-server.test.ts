import { describe, it, expect } from "vitest";

const mod = await import("./auth-server");
const {
  signSession,
  verifySession,
  extractSession,
  extractSessionFromCookieHeader,
  makeSessionCookie,
  makeClearSessionCookie,
} = mod;

describe("signSession / verifySession", () => {
  it("signs and verifies a session", () => {
    const signed = signSession("user@example.com");
    const payload = verifySession(signed);
    expect(payload).not.toBeNull();
    expect(payload!.email).toBe("user@example.com");
  });

  it("rejects a tampered signature", () => {
    const signed = signSession("user@example.com");
    const tampered = signed.slice(0, -4) + "dead";
    expect(verifySession(tampered)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const signed = signSession("user@example.com");
    const [, sig] = signed.split(".");
    const fakePayload = Buffer.from(
      JSON.stringify({ email: "evil@example.com", exp: Math.floor(Date.now() / 1000) + 9999 }),
    ).toString("base64url");
    expect(verifySession(`${fakePayload}.${sig}`)).toBeNull();
  });

  it("rejects a cookie without a dot separator", () => {
    expect(verifySession("noseparator")).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(verifySession("")).toBeNull();
  });
});

describe("extractSession", () => {
  it("extracts and verifies session from cookie", () => {
    const signed = signSession("user@example.com");
    const req = new Request("http://localhost", {
      headers: { Cookie: `claw-session=${encodeURIComponent(signed)}; other=val` },
    });
    const payload = extractSession(req);
    expect(payload).not.toBeNull();
    expect(payload!.email).toBe("user@example.com");
  });

  it("returns null when no cookie header", () => {
    const req = new Request("http://localhost");
    expect(extractSession(req)).toBeNull();
  });

  it("returns null when cookie has invalid signature", () => {
    const req = new Request("http://localhost", {
      headers: { Cookie: "claw-session=invalid.value" },
    });
    expect(extractSession(req)).toBeNull();
  });
});

describe("extractSessionFromCookieHeader", () => {
  it("extracts session from raw cookie header string", () => {
    const signed = signSession("test@example.com");
    const payload = extractSessionFromCookieHeader(
      `claw-session=${encodeURIComponent(signed)}; path=/`,
    );
    expect(payload).not.toBeNull();
    expect(payload!.email).toBe("test@example.com");
  });

  it("returns null for missing cookie", () => {
    expect(extractSessionFromCookieHeader("other=val")).toBeNull();
  });

  it("returns null for undefined header", () => {
    expect(extractSessionFromCookieHeader(undefined)).toBeNull();
  });
});

describe("makeSessionCookie", () => {
  it("creates an httpOnly SameSite=Strict cookie", () => {
    const cookie = makeSessionCookie("signed-value");
    expect(cookie).toContain("claw-session=signed-value");
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
