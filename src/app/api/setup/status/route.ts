import { detectClaude } from "@/lib/claude-status";
import { extractSession, unauthorized } from "@/lib/auth-server";

export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();
  return Response.json(detectClaude());
}
