import { detectClaude } from "@/lib/claude-status";
import { extractSession, unauthorized } from "@/lib/auth-server";

const startTime = Date.now();

/**
 * Authenticated status endpoint — exposes Claude binary details and other
 * deployment info. Requires a valid session cookie (same as all other
 * authenticated API routes). The unauthenticated /api/health endpoint
 * intentionally omits these details.
 */
export async function GET(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  return Response.json({
    status: "ok",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    claude: detectClaude(),
  });
}
