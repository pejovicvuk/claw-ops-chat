import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { getAuditWriter } from "@/lib/audit/writer";
import { getByPort, start } from "@/lib/dev-server/manager";
import type { Framework, StartRequest } from "@/lib/dev-server/types";
import { PROJECT_SLUG_RE } from "@/lib/projects/validation";

/**
 * POST /api/dev-server/start
 *
 * Body: { projectSlug, itemSlug, port?, framework? }
 *   - projectSlug / itemSlug — required; validated against the
 *     existing PROJECT_SLUG_RE so we never spawn outside the
 *     projects tree.
 *   - port — optional; falls back to detection's default.
 *   - framework — optional; falls back to detection.
 *
 * Returns the freshly-spawned `RunningServer`. 409 if a server is
 * already running on that (project, item, port) tuple.
 */

const KNOWN_FRAMEWORKS: ReadonlySet<Framework> = new Set([
  "next",
  "vite",
  "cra",
  "nestjs",
  "astro",
  "nuxt",
  "node-script",
  "unknown",
]);

async function handler(request: Request): Promise<Response> {
  const session = extractSession(request);
  if (!session) return unauthorized();

  let body: StartRequest;
  try {
    body = (await request.json()) as StartRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const projectSlug = String(body.projectSlug ?? "");
  const itemSlug = String(body.itemSlug ?? "");
  if (!PROJECT_SLUG_RE.test(projectSlug) || !PROJECT_SLUG_RE.test(itemSlug)) {
    return Response.json({ error: "Invalid projectSlug or itemSlug" }, { status: 400 });
  }
  if (
    body.port !== undefined &&
    (!Number.isInteger(body.port) || body.port < 1024 || body.port > 65535)
  ) {
    return Response.json({ error: "port must be an integer in [1024, 65535]" }, { status: 400 });
  }
  if (body.framework !== undefined && !KNOWN_FRAMEWORKS.has(body.framework)) {
    return Response.json({ error: `Unknown framework: ${body.framework}` }, { status: 400 });
  }

  // 409 if already running on this (project, item, port) tuple.
  if (body.port !== undefined && getByPort(projectSlug, itemSlug, body.port)) {
    return Response.json(
      { error: `Already running on port ${body.port} for ${projectSlug}/${itemSlug}` },
      { status: 409 },
    );
  }

  let started;
  try {
    started = await start({
      projectSlug,
      itemSlug,
      port: body.port,
      framework: body.framework,
      actorEmail: session.email,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to spawn dev server" },
      { status: 500 },
    );
  }

  // Audit (session-scoped — same shape Claude tool spawns use).
  void getAuditWriter()
    .session({
      type: "tool_use_complete",
      severity: "info",
      actor: session.email,
      subject: `Dev server started: ${started.framework} on :${started.port}`,
      durationMs: null,
      sessionId: started.id,
      claudeSessionId: null,
      turnId: undefined,
      toolName: `dev-server:${started.framework}`,
      details: {
        projectSlug: started.projectSlug,
        itemSlug: started.itemSlug,
        port: started.port,
        pid: started.pid,
      },
    })
    .catch(() => {});

  return Response.json(started, { status: 201 });
}

export const POST = withAudit(
  {
    route: "/api/dev-server/start",
    label: "Start dev server",
    subjectFrom: async (req) => {
      try {
        const body = (await req.clone().json()) as StartRequest;
        return `${body.projectSlug ?? "?"}/${body.itemSlug ?? "?"}:${body.port ?? "auto"}`;
      } catch {
        return null;
      }
    },
  },
  handler,
);
