import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const COOKIE_NAME = "claw-session";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

/** HMAC key for signing session cookies. Auto-generated if not provided. */
const SESSION_SECRET =
  process.env.SESSION_SECRET || randomBytes(32).toString("hex");

/* ------------------------------------------------------------------ */
/*  HMAC-signed session cookie                                         */
/* ------------------------------------------------------------------ */

interface SessionPayload {
  email: string;
  exp: number; // Unix timestamp (seconds)
}

/**
 * Sign a session payload: base64(JSON) + "." + hmac_hex
 */
export function signSession(email: string): string {
  const payload: SessionPayload = {
    email,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", SESSION_SECRET).update(data).digest("hex");
  return `${data}.${sig}`;
}

/**
 * Verify a signed session cookie. Returns the payload or null.
 */
export function verifySession(
  cookie: string,
): SessionPayload | null {
  const dotIdx = cookie.indexOf(".");
  if (dotIdx === -1) return null;

  const data = cookie.slice(0, dotIdx);
  const sig = cookie.slice(dotIdx + 1);

  // Verify HMAC
  const expected = createHmac("sha256", SESSION_SECRET).update(data).digest("hex");
  if (sig.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }

  // Decode payload
  try {
    const payload = JSON.parse(
      Buffer.from(data, "base64url").toString(),
    ) as SessionPayload;
    // Check expiry
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Token extraction from requests                                     */
/* ------------------------------------------------------------------ */

/**
 * Extract and verify session from a Next.js Request object.
 * Reads the httpOnly cookie.
 */
export function extractSession(
  request: Request,
): SessionPayload | null {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;
  const cookieValue = parseCookieValue(cookieHeader, COOKIE_NAME);
  if (!cookieValue) return null;
  return verifySession(cookieValue);
}

/**
 * Extract and verify session from a raw HTTP cookie header string.
 * Used by server.ts for WebSocket upgrade requests.
 */
export function extractSessionFromCookieHeader(
  cookieHeader: string | undefined,
): SessionPayload | null {
  if (!cookieHeader) return null;
  const cookieValue = parseCookieValue(cookieHeader, COOKIE_NAME);
  if (!cookieValue) return null;
  return verifySession(cookieValue);
}

/* ------------------------------------------------------------------ */
/*  Cookie helpers                                                     */
/* ------------------------------------------------------------------ */

export function unauthorized() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

/** Create Set-Cookie header value for the signed session. */
export function makeSessionCookie(signedValue: string): string {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(signedValue)}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/chat",
    `Max-Age=${SESSION_MAX_AGE}`,
  ];
  if (IS_PRODUCTION) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/** Create Set-Cookie header value that clears the session cookie. */
export function makeClearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/chat; Max-Age=0`;
}

function parseCookieValue(header: string, name: string): string | null {
  const prefix = `${name}=`;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}
