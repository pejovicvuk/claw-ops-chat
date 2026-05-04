import { extractSession, unauthorized } from "@/lib/auth-server";
import { getMetricsCollector } from "@/lib/monitoring/singleton";
import { getAlertEngine } from "@/lib/monitoring/alerts/engine";
import { formatBytes, formatPercent, formatDurationMs } from "@/lib/monitoring/format";
import {
  bandStatus,
  PERCENT_USAGE,
  DISK_USAGE,
  EVENT_LOOP_LAG_MS,
  ERROR_RATE_PCT,
} from "@/lib/monitoring/threshold";
import type {
  MonStatus,
  OverviewKeyMetric,
  OverviewSnapshot,
  OverviewSubsystem,
} from "@/lib/monitoring/types";

export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();
  const collector = getMetricsCollector();
  if (!collector) {
    return Response.json({ error: "Monitoring not initialized" }, { status: 503 });
  }

  const health = collector.getHealth();
  const system = collector.getSystem();
  const docker = collector.getDocker();
  const ws = collector.getWs();
  const apm = collector.getApm();
  const logs = collector.getLogs();
  const cron = collector.getCron();
  const previews = collector.getPreviews();

  const subsystems: OverviewSubsystem[] = [];
  const keyMetrics: OverviewKeyMetric[] = [];

  // CPU
  if (system) {
    const cpuStatus = bandStatus(system.cpu.aggregatePct, PERCENT_USAGE);
    keyMetrics.push({
      id: "cpu",
      label: "CPU",
      value: system.cpu.aggregatePct,
      formattedValue: formatPercent(system.cpu.aggregatePct),
      unit: "%",
      status: cpuStatus,
      sparkline: system.cpu.series,
    });
    const memPct =
      system.memory.totalBytes > 0 ? (system.memory.usedBytes / system.memory.totalBytes) * 100 : 0;
    keyMetrics.push({
      id: "memory",
      label: "Memory",
      value: memPct,
      formattedValue: `${formatBytes(system.memory.usedBytes)} / ${formatBytes(system.memory.totalBytes)}`,
      unit: "",
      status: bandStatus(memPct, PERCENT_USAGE),
      sparkline: system.memory.series,
    });
    subsystems.push({
      key: "system",
      status: worseStatus(cpuStatus, bandStatus(memPct, PERCENT_USAGE)),
      summary: `${formatPercent(system.cpu.aggregatePct)} CPU · ${formatPercent(memPct)} RAM`,
    });
    if (system.disks.length > 0) {
      const worstDisk = system.disks.reduce<{
        disk: (typeof system.disks)[number];
        pct: number;
      } | null>((acc, d) => {
        const pct = d.totalBytes > 0 ? (d.usedBytes / d.totalBytes) * 100 : 0;
        if (!acc || pct > acc.pct) return { disk: d, pct };
        return acc;
      }, null);
      if (worstDisk) {
        keyMetrics.push({
          id: "disk",
          label: `Disk (${worstDisk.disk.mount})`,
          value: worstDisk.pct,
          formattedValue: formatPercent(worstDisk.pct),
          unit: "%",
          status: bandStatus(worstDisk.pct, DISK_USAGE),
          sparkline: [],
        });
      }
    }
  } else {
    subsystems.push({ key: "system", status: "unknown", summary: "Collecting…" });
  }

  // Health
  if (health) {
    const lagStatus = bandStatus(health.eventLoop.lagP95Ms, EVENT_LOOP_LAG_MS);
    keyMetrics.push({
      id: "loop",
      label: "Event loop p95",
      value: health.eventLoop.lagP95Ms,
      formattedValue: formatDurationMs(health.eventLoop.lagP95Ms),
      unit: "ms",
      status: lagStatus,
      sparkline: health.series.eventLoopLagP95Ms,
    });
    subsystems.push({
      key: "health",
      status: lagStatus,
      summary: `Uptime ${formatDurationMs(health.process.uptimeMs)} · ${formatBytes(health.memory.rssBytes)} RSS`,
    });
  } else {
    subsystems.push({ key: "health", status: "unknown", summary: "Collecting…" });
  }

  // WS
  if (ws) {
    keyMetrics.push({
      id: "ws-active",
      label: "WS sessions",
      value: ws.active,
      formattedValue: `${ws.active}`,
      unit: "active",
      status: "info",
      sparkline: ws.series.active,
    });
    subsystems.push({
      key: "ws",
      status: "healthy",
      summary: `${ws.active} active · ${ws.msgsInPerSec.toFixed(1)} msg/s in`,
      badge: ws.active > 0 ? `${ws.active}` : undefined,
    });
  } else {
    subsystems.push({ key: "ws", status: "unknown", summary: "Collecting…" });
  }

  // Docker
  if (docker?.available) {
    subsystems.push({
      key: "docker",
      status: "healthy",
      summary: `${docker.aggregates.running} running · ${docker.aggregates.stopped} stopped`,
      badge: `${docker.aggregates.running}/${docker.aggregates.running + docker.aggregates.stopped}`,
    });
  } else {
    subsystems.push({
      key: "docker",
      status: "unknown",
      summary: docker?.reason ?? "Not configured",
    });
  }

  // APM
  if (apm) {
    const errStatus = bandStatus(apm.summary.errorRate, ERROR_RATE_PCT);
    subsystems.push({
      key: "apm",
      status: errStatus,
      summary: `${apm.summary.rpm.toFixed(0)} rpm · ${apm.summary.errorRate.toFixed(1)}% errors`,
    });
  } else {
    subsystems.push({ key: "apm", status: "unknown", summary: "Collecting…" });
  }

  // Logs
  if (logs) {
    const errStatus =
      logs.counts.errorsLast5m === 0
        ? "healthy"
        : logs.counts.errorsLast5m > 10
          ? "critical"
          : "warning";
    subsystems.push({
      key: "logs",
      status: errStatus,
      summary: `${logs.counts.errorsLast5m} errors / 5m`,
      badge: logs.counts.errorsLast5m > 0 ? `${logs.counts.errorsLast5m}` : undefined,
    });
  } else {
    subsystems.push({ key: "logs", status: "unknown", summary: "Collecting…" });
  }

  // Previews (Phase 6a #134)
  if (previews) {
    const atCap = previews.maxActive > 0 && previews.active >= previews.maxActive;
    const status: MonStatus = atCap
      ? "warning"
      : previews.totalRestartCount > 0
        ? "warning"
        : previews.active > 0
          ? "healthy"
          : "info";
    const restartTail =
      previews.totalRestartCount > 0 ? ` · ${previews.totalRestartCount} restart(s)` : "";
    subsystems.push({
      key: "previews",
      status,
      summary: `${previews.active}/${previews.maxActive} active${restartTail}`,
      badge: previews.active > 0 ? `${previews.active}` : undefined,
    });
  } else {
    subsystems.push({ key: "previews", status: "unknown", summary: "Collecting…" });
  }

  // Cron
  if (cron) {
    subsystems.push({
      key: "cron",
      status: cron.aggregates.successRate >= 95 ? "healthy" : "warning",
      summary: `${cron.aggregates.jobsActive} jobs · ${cron.aggregates.runsLast24h} runs (24h)`,
      badge: cron.aggregates.jobsRunning > 0 ? `${cron.aggregates.jobsRunning}` : undefined,
    });
  } else {
    subsystems.push({ key: "cron", status: "unknown", summary: "Collecting…" });
  }

  // Audit (always healthy unless writes failing — audit reader handles)
  subsystems.push({
    key: "audit",
    status: "healthy",
    summary: "Recording activity",
  });

  // Alerts
  const firingAll = getAlertEngine().currentlyFiring();
  subsystems.push({
    key: "alerts",
    status:
      firingAll.length === 0
        ? "healthy"
        : firingAll.some((a) => a.severity === "critical")
          ? "critical"
          : "warning",
    summary: firingAll.length === 0 ? "No firing alerts" : `${firingAll.length} firing`,
    badge: firingAll.length > 0 ? `${firingAll.length}` : undefined,
  });

  const overall = subsystems.reduce<MonStatus>((acc, s) => worseStatus(acc, s.status), "healthy");

  const result: OverviewSnapshot = {
    overall,
    uptimeMs: Math.round(process.uptime() * 1000),
    capabilities: collector.getCapabilities(),
    subsystems,
    keyMetrics,
    firingAlerts: firingAll.slice(0, 10).map((a) => ({
      id: a.id,
      severity: a.severity,
      ruleName: a.ruleName,
      firingForMs: Date.now() - a.firedAt,
      observedValue: a.observedValue,
      threshold: a.threshold,
    })),
  };
  return Response.json(result);
}

function worseStatus(a: MonStatus, b: MonStatus): MonStatus {
  const order: MonStatus[] = ["healthy", "info", "warning", "critical", "unknown"];
  return order.indexOf(b) > order.indexOf(a) ? b : a;
}
