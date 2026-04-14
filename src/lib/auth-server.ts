import { timingSafeEqual } from "crypto";

const CLAW_CHAT_TOKEN = process.env.CLAW_CHAT_TOKEN;
const COOKIE_NAME = "claw-session";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

export function validateToken(token: string): boolean {
  if (!CLAW_CHAT_TOKEN) return false;
  if (token.length !== CLAW_CHAT_TOKEN.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(token),
      Buffer.from(CLAW_CHAT_TOKEN),
    );
  } catch {
    return false;
  }
}

/**
 * Extract auth token from request — checks httpOnly cookie first,
 * then falls back to Authorization: Bearer header for API compatibility.
 */
export function extractToken(request: Request): string | null {
  // Try cookie first (preferred — httpOnly, not accessible to JS)
  const cookieHeader = request.headers.get("Cookie");
  if (cookieHeader) {
    const token = parseCookieValue(cookieHeader, COOKIE_NAME);
    if (token) return token;
  }

  // Fallback to Bearer token
  return extractBearerToken(request);
}

export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

/**
 * Extract token from raw HTTP cookie header string (for WebSocket upgrade).
 */
export function extractTokenFromCookieHeader(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  return parseCookieValue(cookieHeader, COOKIE_NAME);
}

export function unauthorized() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Create Set-Cookie header value for the auth token.
 */
export function makeSessionCookie(token: string): string {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/chat",
    `Max-Age=${60 * 60 * 24 * 7}`, // 7 days
  ];
  if (IS_PRODUCTION) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/**
 * Create Set-Cookie header value that clears the session cookie.
 */
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
