import { extractSession, unauthorized } from "@/lib/auth-server";
import {
  getDockerPruneConfig,
  updateDockerPruneConfig,
  type DockerPruneConfig,
} from "@/lib/monitoring/docker-prune";

export async function GET(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const config = await getDockerPruneConfig();
  return Response.json(config);
}

export async function PUT(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  let body: { enabled?: unknown; intervalDays?: unknown };
  try {
    body = (await request.json()) as { enabled?: unknown; intervalDays?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const patch: Partial<Pick<DockerPruneConfig, "enabled" | "intervalDays">> = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.intervalDays === "number") patch.intervalDays = body.intervalDays;
  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "No valid fields to update" }, { status: 400 });
  }
  const next = await updateDockerPruneConfig(patch);
  return Response.json(next);
}
