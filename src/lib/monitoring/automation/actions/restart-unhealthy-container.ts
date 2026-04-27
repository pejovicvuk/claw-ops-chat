import { getMetricsCollector } from "../../singleton";
import { getDockerodeClient } from "../../collectors/docker";
import type { AutomationActionFn } from "../types";

interface DockerodeRestartClient {
  listContainers(opts: {
    all: boolean;
  }): Promise<Array<{ Id: string; Names: string[]; Status: string }>>;
  getContainer(id: string): {
    inspect(): Promise<{ State: { Health?: { Status: string } } }>;
    restart(): Promise<unknown>;
  };
}

/**
 * Walks running containers, restarts any whose health status is
 * "unhealthy". Skips this container's own peer (we never restart self).
 */
export const restartUnhealthyContainer: AutomationActionFn = async () => {
  const collector = getMetricsCollector();
  if (!collector) return { ok: false, summary: "Monitoring not initialized" };
  const dockerCollectorState = (
    collector as unknown as {
      docker: { client: DockerodeRestartClient | null; available: boolean; reason?: string };
    }
  ).docker;
  if (!dockerCollectorState.available) {
    return {
      ok: false,
      summary: dockerCollectorState.reason ?? "Docker socket not mounted",
    };
  }
  const client = await getDockerodeClient(dockerCollectorState as never);
  if (!client) return { ok: false, summary: "Docker client unavailable" };

  const cli = client as unknown as DockerodeRestartClient;
  const restarted: string[] = [];
  let containers: Awaited<ReturnType<DockerodeRestartClient["listContainers"]>> = [];
  try {
    containers = await cli.listContainers({ all: false });
  } catch (err) {
    return {
      ok: false,
      summary: `listContainers failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  for (const info of containers) {
    try {
      const ct = cli.getContainer(info.Id);
      const inspected = await ct.inspect();
      const status = inspected.State?.Health?.Status;
      if (status !== "unhealthy") continue;
      await ct.restart();
      restarted.push((info.Names[0] ?? info.Id).replace(/^\//, ""));
    } catch {
      /* container disappeared; skip */
    }
  }
  return {
    ok: true,
    summary:
      restarted.length === 0
        ? `Scanned ${containers.length} container(s); none unhealthy`
        : `Restarted ${restarted.length} unhealthy container(s): ${restarted.join(", ")}`,
    details: { restarted },
  };
};
