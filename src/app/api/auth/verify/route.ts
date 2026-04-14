import { validateToken, makeSessionCookie } from "@/lib/auth-server";

export async function POST(request: Request) {
  const body = await request.json();
  const token = body?.token;

  if (!token || typeof token !== "string") {
    return Response.json({ error: "Token required" }, { status: 400 });
  }

  if (!validateToken(token)) {
    return Response.json({ error: "Invalid token" }, { status: 401 });
  }

  // Set httpOnly cookie so the token is no longer exposed to client-side JS
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": makeSessionCookie(token),
    },
  });
}
