import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { getAuditWriter } from "@/lib/audit/writer";
import { get, stop } from "@/lib/dev-server/manager";
import type { StopRequest } from "@/lib/dev-server/types";

/**
 * POST /api/dev-server/stop
 *
 * Body: { id }  — composite id from manager.start (`projectSlug/itemSlug/port`).
 *
 * Returns `{ exitCode }` once the process has exited (or the SIGKILL
 * escalation has fired). Always 200 — a missing id is silently
 * treated as already-stopped.
 */

async function handler(request: Request): Promise<Response> {
  const session = extractSession(request);
  if (!session) return unauthorized();

  let body: StopRequest;
  try {
    body = (await request.json()) as StopRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = String(body.id ?? "");
  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const before = get(id);
  const result = await stop(id);

  if (before) {
    void getAuditWriter()
      .session({
        type: "tool_use_complete",
        severity: "info",
        actor: session.email,
        subject: `Dev server stopped: :${before.port}`,
        durationMs: Date.now() - before.startedAt,
        sessionId: before.id,
        claudeSessionId: null,
        turnId: undefined,
        toolName: `dev-server:stop`,
        details: {
          projectSlug: before.projectSlug,
          itemSlug: before.itemSlug,
          port: before.port,
          exitCode: result.exitCode,
        },
      })
      .catch(() => {});
  }

  return Response.json(result);
}

export const POST = withAudit(
  {
    route: "/api/dev-server/stop",
    label: "Stop dev server",
    subjectFrom: async (req) => {
      try {
        const body = (await req.clone().json()) as StopRequest;
        return body.id ?? null;
      } catch {
        return null;
      }
    },
  },
  handler,
);
