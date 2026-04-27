import type { MetricsCollector } from "../collector";

/**
 * Resolves a dotted metric path against the collector's snapshot tree.
 * Examples: "health.eventLoop.lagP95Ms", "system.cpu.aggregatePct",
 * "system.memory.usedBytes", "apm.summary.errorRate", "ws.active".
 *
 * Returns `null` for unknown / non-numeric paths so the evaluator can
 * skip the rule cleanly.
 *
 * A handful of derived percentages aren't exposed as raw fields by the
 * collectors but are useful for thresholds — we compute them here so
 * users can reference e.g. `health.memory.heapUsedPct` directly.
 */
export function metricLookup(collector: MetricsCollector): (path: string) => number | null {
  return (path: string) => {
    // Derived metrics first.
    const derived = lookupDerived(collector, path);
    if (derived !== undefined) return derived;

    const [section, ...rest] = path.split(".");
    let snapshot: unknown;
    switch (section) {
      case "health":
        snapshot = collector.getHealth();
        break;
      case "system":
        snapshot = collector.getSystem();
        break;
      case "ws":
        snapshot = collector.getWs();
        break;
      case "apm":
        snapshot = collector.getApm();
        break;
      case "logs":
        snapshot = collector.getLogs();
        break;
      case "docker":
        snapshot = collector.getDocker();
        break;
      case "processes":
        snapshot = collector.getProcesses();
        break;
      case "cron":
        snapshot = collector.getCron();
        break;
      default:
        return null;
    }
    if (!snapshot) return null;
    let cursor: unknown = snapshot;
    for (const key of rest) {
      if (cursor === null || typeof cursor !== "object") return null;
      const obj = cursor as Record<string, unknown>;
      if (!(key in obj)) return null;
      cursor = obj[key];
    }
    if (typeof cursor === "number" && Number.isFinite(cursor)) return cursor;
    return null;
  };
}

function lookupDerived(collector: MetricsCollector, path: string): number | null | undefined {
  switch (path) {
    case "health.memory.heapUsedPct": {
      const h = collector.getHealth();
      if (!h || h.memory.heapTotalBytes <= 0) return null;
      return (h.memory.heapUsedBytes / h.memory.heapTotalBytes) * 100;
    }
    case "system.memory.usedPct": {
      const s = collector.getSystem();
      if (!s || s.memory.totalBytes <= 0) return null;
      return (s.memory.usedBytes / s.memory.totalBytes) * 100;
    }
    case "system.swap.usedPct": {
      const s = collector.getSystem();
      if (!s || s.swap.totalBytes <= 0) return null;
      return (s.swap.usedBytes / s.swap.totalBytes) * 100;
    }
    case "system.disk.maxUsedPct": {
      const s = collector.getSystem();
      if (!s) return null;
      let max = 0;
      for (const d of s.disks) {
        if (d.totalBytes <= 0) continue;
        const pct = (d.usedBytes / d.totalBytes) * 100;
        if (pct > max) max = pct;
      }
      return max;
    }
    case "docker.unhealthyCount": {
      const d = collector.getDocker();
      if (!d?.available) return null;
      return d.containers.filter((c) => c.health === "unhealthy").length;
    }
    default:
      return undefined;
  }
}

/**
 * The list of known metric paths surfaced in the alert rule editor's
 * autocomplete. Kept here (not in the React component) so the server
 * can validate `rule.metric` on POST.
 */
export const KNOWN_METRICS: string[] = [
  // Health
  "health.memory.rssBytes",
  "health.memory.heapUsedBytes",
  "health.memory.heapTotalBytes",
  "health.memory.heapUsedPct",
  "health.eventLoop.lagP50Ms",
  "health.eventLoop.lagP95Ms",
  "health.eventLoop.lagP99Ms",
  "health.eventLoop.lagMaxMs",
  "health.gc.pausesPerMin",
  "health.gc.totalPauseMsPerMin",
  // System
  "system.cpu.aggregatePct",
  "system.cpu.load1",
  "system.memory.usedBytes",
  "system.memory.usedPct",
  "system.swap.usedBytes",
  "system.swap.usedPct",
  "system.disk.maxUsedPct",
  "system.fileDescriptors.open",
  // Docker
  "docker.unhealthyCount",
  // APM
  "apm.summary.rpm",
  "apm.summary.errorRate",
  "apm.summary.p50Ms",
  "apm.summary.p95Ms",
  "apm.summary.p99Ms",
  "apm.sdk.turnP50Ms",
  "apm.sdk.turnP95Ms",
  "apm.sdk.turnP99Ms",
  // WS
  "ws.active",
  "ws.msgsInPerSec",
  "ws.msgsOutPerSec",
  // Logs
  "logs.counts.errorsLast5m",
  "logs.counts.errorsLast1h",
  "logs.counts.errorsLast24h",
  "logs.counts.tailRatePerSec",
  // Cron
  "cron.aggregates.jobsRunning",
  "cron.aggregates.runsLast24h",
  "cron.aggregates.successRate",
];
