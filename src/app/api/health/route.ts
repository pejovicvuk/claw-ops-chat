const startTime = Date.now();

/**
 * Unauthenticated liveness probe — intentionally minimal to avoid leaking
 * deployment details (binary versions, paths) to unauthenticated callers.
 * Claude binary details are exposed via the authenticated /api/status route.
 */
export async function GET() {
  return Response.json({
    status: "ok",
    uptime: Math.floor((Date.now() - startTime) / 1000),
  });
}
