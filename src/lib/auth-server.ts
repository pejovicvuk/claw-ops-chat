import { timingSafeEqual } from "crypto";

const CLAW_CHAT_TOKEN = process.env.CLAW_CHAT_TOKEN;

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

export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

export function unauthorized() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
