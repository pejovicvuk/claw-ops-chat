import { getMetricsCollector } from "../../singleton";
import { getDockerodeClient } from "../../collectors/docker";
import type { AutomationActionFn } from "../types";

interface DockerodePruneClient {
  pruneImages(opts: { filters: Record<string, string[]> }): Promise<{
    ImagesDeleted?: Array<{ Untagged?: string; Deleted?: string }>;
    SpaceReclaimed?: number;
  }>;
}

/**
 * Prunes dangling Docker images older than `options.olderThanHours`.
 * Calls the Docker prune endpoint (`POST /images/prune`) which is a
 * non-destructive cleanup of orphaned images (those not referenced by
 * any tag).
 */
export const pruneDockerImages: AutomationActionFn = async (ctx) => {
  const collector = getMetricsCollector();
  if (!collector) return { ok: false, summary: "Monitoring not initialized" };
  const dockerCollectorState = (
    collector as unknown as {
      docker: { client: DockerodePruneClient | null; available: boolean; reason?: string };
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

  const cli = client as unknown as DockerodePruneClient;
  const olderThanHours =
    typeof ctx.rule.options.olderThanHours === "number" ? ctx.rule.options.olderThanHours : 168;

  try {
    const result = await cli.pruneImages({
      filters: { until: [`${olderThanHours}h`], dangling: ["false"] },
    });
    const count = result.ImagesDeleted?.length ?? 0;
    const reclaimedBytes = result.SpaceReclaimed ?? 0;
    return {
      ok: true,
      summary: `Pruned ${count} image(s), reclaimed ${(reclaimedBytes / (1024 * 1024)).toFixed(1)} MB`,
      details: { count, reclaimedBytes },
    };
  } catch (err) {
    return {
      ok: false,
      summary: `pruneImages failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};
