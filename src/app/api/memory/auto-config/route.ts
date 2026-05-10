import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { loadAutoMemoryConfig, updateAutoMemoryConfig } from "@/lib/memory/auto-config";

/**
 * GET /api/memory/auto-config — current auto-collected memory toggle + idle window.
 * PUT /api/memory/auto-config — patch enabled/idleMs.
 */
export async function GET(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const config = await loadAutoMemoryConfig();
  return Response.json({ config });
}

async function putHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  let body: { enabled?: unknown; idleMs?: unknown };
  try {
    body = (await request.json()) as { enabled?: unknown; idleMs?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const patch: { enabled?: boolean; idleMs?: number } = {};
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return Response.json({ error: "enabled must be boolean" }, { status: 400 });
    }
    patch.enabled = body.enabled;
  }
  if (body.idleMs !== undefined) {
    if (typeof body.idleMs !== "number" || !Number.isFinite(body.idleMs)) {
      return Response.json({ error: "idleMs must be a number" }, { status: 400 });
    }
    patch.idleMs = body.idleMs;
  }
  const config = await updateAutoMemoryConfig(patch);
  return Response.json({ config });
}

export const PUT = withAudit(
  {
    route: "/api/memory/auto-config",
    label: "Update auto-memory config",
  },
  putHandler,
);
