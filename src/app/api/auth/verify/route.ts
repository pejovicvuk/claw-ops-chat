import { validateToken } from "@/lib/auth-server";

export async function POST(request: Request) {
  const body = await request.json();
  const token = body?.token;

  if (!token || typeof token !== "string") {
    return Response.json({ error: "Token required" }, { status: 400 });
  }

  if (!validateToken(token)) {
    return Response.json({ error: "Invalid token" }, { status: 401 });
  }

  return Response.json({ ok: true });
}
