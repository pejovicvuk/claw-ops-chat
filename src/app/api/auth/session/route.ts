import {
  signSession,
  makeSessionCookie,
  makeClearSessionCookie,
} from "@/lib/auth-server";

const API_ORIGIN = (
  process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:8080"
).replace(/\/+$/, "");
const ALLOWED_EMAIL = process.env.ALLOWED_EMAIL || "";

/**
 * POST /api/auth/session
 *
 * Establishes a local session after successful JWT login.
 * 1. Reads the access token from the Authorization header.
 * 2. Validates it by calling the Spring backend's /auth/me.
 * 3. Checks the user's email against ALLOWED_EMAIL.
 * 4. If valid, sets a signed httpOnly session cookie.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json({ error: "Access token required" }, { status: 401 });
  }

  const accessToken = authHeader.slice(7);

  // Validate the access token against the Spring backend
  let user: { email: string; id: string; username: string; role: string };
  try {
    const meRes = await fetch(`${API_ORIGIN}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!meRes.ok) {
      return Response.json({ error: "Invalid access token" }, { status: 401 });
    }
    user = await meRes.json();
  } catch {
    return Response.json(
      { error: "Failed to validate token with backend" },
      { status: 502 },
    );
  }

  // Check email against allowed email
  if (
    !ALLOWED_EMAIL ||
    user.email.toLowerCase() !== ALLOWED_EMAIL.toLowerCase()
  ) {
    return Response.json(
      { error: "This email is not authorized to access this application." },
      { status: 403 },
    );
  }

  // Sign a local session cookie
  const signed = signSession(user.email);

  return new Response(JSON.stringify({ user }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": makeSessionCookie(signed),
    },
  });
}

/**
 * DELETE /api/auth/session
 *
 * Clears the local session cookie (logout).
 */
export async function DELETE() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": makeClearSessionCookie(),
    },
  });
}
