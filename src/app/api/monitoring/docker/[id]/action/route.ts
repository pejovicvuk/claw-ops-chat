import { extractSession, unauthorized } from "@/lib/auth-server";
import { getAuditWriter } from "@/lib/audit/writer";
import { getMetricsCollector } from "@/lib/monitoring/singleton";
import { getDockerodeClient } from "@/lib/monitoring/collectors/docker";

interface DockerodeActionContainer {
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
  restart(): Promise<unknown>;
  pause(): Promise<unknown>;
  unpause(): Promise<unknown>;
}

interface DockerActionClient {
  getContainer(id: string): DockerodeActionContainer;
}

const ID_RE = /^[a-zA-Z0-9_.-]{1,200}$/;
const VALID_ACTIONS = new Set(["start", "stop", "restart", "pause", "unpause"]);

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = extractSession(request);
  if (!session) return unauthorized();
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) {
    return Response.json({ error: "Invalid container id" }, { status: 400 });
  }
  let body: { action?: unknown };
  try {
    body = (await request.json()) as { action?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";
  if (!VALID_ACTIONS.has(action)) {
    return Response.json(
      { error: `action must be one of: ${[...VALID_ACTIONS].join(", ")}` },
      { status: 400 },
    );
  }

  const collector = getMetricsCollector();
  const docker = collector?.getDocker();
  if (!collector || !docker?.available) {
    return Response.json({ error: "Docker not configured" }, { status: 400 });
  }
  const dockerCollectorState = (
    collector as unknown as {
      docker: { client: DockerActionClient | null; available: boolean; reason?: string };
    }
  ).docker;
  const cli = await getDockerodeClient(dockerCollectorState as never);
  if (!cli) {
    return Response.json(
      { error: dockerCollectorState.reason ?? "Docker unavailable" },
      { status: 400 },
    );
  }

  try {
    const ct = (cli as unknown as DockerActionClient).getContainer(id);
    switch (action) {
      case "start":
        await ct.start();
        break;
      case "stop":
        await ct.stop();
        break;
      case "restart":
        await ct.restart();
        break;
      case "pause":
        await ct.pause();
        break;
      case "unpause":
        await ct.unpause();
        break;
    }
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "action failed" },
      { status: 500 },
    );
  }

  await getAuditWriter()
    .api({
      type: "request_complete",
      severity: "warn",
      actor: session.email,
      subject: `monitoring.docker_${action}: ${id.slice(0, 12)}`,
      durationMs: null,
      route: "/api/monitoring/docker/[id]/action",
      method: "POST",
      statusCode: 200,
      target: id,
      details: { action, containerId: id },
    })
    .catch(() => {});

  return Response.json({ ok: true });
}
