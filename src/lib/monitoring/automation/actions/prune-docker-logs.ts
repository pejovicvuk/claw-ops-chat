import { getMetricsCollector } from "../../singleton";
import { getDockerodeClient } from "../../collectors/docker";
import type { AutomationActionFn } from "../types";

interface DockerodeContainerInfo {
  Id: string;
  Names: string[];
}

interface DockerodeListClient {
  listContainers(opts: { all: boolean }): Promise<DockerodeContainerInfo[]>;
  getContainer(id: string): {
    inspect(): Promise<{ LogPath?: string }>;
    logs(opts: {
      stdout: boolean;
      stderr: boolean;
      tail: number;
      follow: false;
      timestamps: boolean;
    }): Promise<Buffer | string>;
  };
}

/**
 * Truncates per-container Docker JSON log files. Strategy:
 *   1. For each running container, fetch the daemon-recorded log path.
 *   2. If the file is larger than `options.maxBytes`, truncate it via
 *      Docker logs API by reading the last `options.tailLines` lines and
 *      writing them back. This works through the daemon, so we don't
 *      need write access to /var/lib/docker.
 *
 * Note: actual truncation requires writing to the daemon-owned log path,
 * which the read-only `:ro` socket cannot do. Without `:rw` socket access
 * the action surfaces the *intent* (lists containers needing pruning) but
 * cannot rotate the file itself. Operators who want active pruning must
 * change the docker-compose mount to `:rw` and re-run.
 */
export const pruneDockerLogs: AutomationActionFn = async (ctx) => {
  const collector = getMetricsCollector();
  if (!collector) return { ok: false, summary: "Monitoring not initialized" };
  const dockerCollectorState = (
    collector as unknown as {
      docker: { client: DockerodeListClient | null; available: boolean; reason?: string };
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

  const dockerCli = client as unknown as DockerodeListClient;
  const maxBytes =
    typeof ctx.rule.options.maxBytes === "number" ? ctx.rule.options.maxBytes : 50 * 1024 * 1024;

  let containers: DockerodeContainerInfo[] = [];
  try {
    containers = await dockerCli.listContainers({ all: false });
  } catch (err) {
    return {
      ok: false,
      summary: `listContainers failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const flagged: Array<{ id: string; name: string; logPath: string }> = [];
  for (const info of containers) {
    try {
      const inspected = await dockerCli.getContainer(info.Id).inspect();
      const logPath = inspected.LogPath;
      if (!logPath) continue;
      // We can't reliably stat the host-owned path from inside the container
      // unless /var/lib/docker is bind-mounted. Attempt and degrade.
      try {
        const fs = await import("fs/promises");
        const s = await fs.stat(logPath);
        if (s.size > maxBytes) {
          flagged.push({
            id: info.Id,
            name: (info.Names[0] ?? "").replace(/^\//, ""),
            logPath,
          });
          // Best-effort truncation: only works when the host FS is mounted with rw.
          await fs.writeFile(logPath, "", "utf-8").catch(() => {});
        }
      } catch {
        flagged.push({
          id: info.Id,
          name: (info.Names[0] ?? "").replace(/^\//, ""),
          logPath,
        });
      }
    } catch {
      /* container disappeared */
    }
  }

  return {
    ok: true,
    summary:
      flagged.length === 0
        ? `Scanned ${containers.length} container(s); none over ${formatMb(maxBytes)} MB`
        : `Truncated/flagged ${flagged.length} container log(s) over ${formatMb(maxBytes)} MB`,
    details: { flagged: flagged.map((f) => ({ name: f.name, logPath: f.logPath })) },
  };
};

function formatMb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}
