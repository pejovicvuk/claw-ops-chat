"use client";

import { FiAlertTriangle } from "react-icons/fi";
import { useMonPoll } from "@/lib/monitoring/use-mon-poll";
import { formatDurationMs } from "@/lib/monitoring/format";
import type { OverviewSnapshot } from "@/lib/monitoring/types";
import { useMonContext } from "../monitoring-context";
import { MetricCard } from "../primitives/metric-card";
import { SectionGrid } from "../primitives/section-grid";
import { StatusBadge } from "../primitives/status-badge";

export function OverviewSection() {
  const { refreshMs, paused, setTab } = useMonContext();
  const { data, error, loading } = useMonPoll<OverviewSnapshot>("/api/monitoring/overview", {
    intervalMs: refreshMs,
    paused,
  });

  const overall = data?.overall ?? "unknown";

  return (
    <div className="space-y-4 p-4">
      {/* Hero strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-canvas-border bg-canvas-bg p-4">
        <div className="flex items-center gap-3">
          <StatusBadge status={overall} size="sm" />
          <div>
            <p className="text-[11px] uppercase tracking-wide text-canvas-muted">Overall</p>
            <p className="text-[15px] font-semibold text-canvas-fg">
              {overall === "healthy"
                ? "All systems healthy"
                : overall === "warning"
                  ? "One or more subsystems degraded"
                  : overall === "critical"
                    ? "Critical issues detected"
                    : "Initializing…"}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wide text-canvas-muted">Uptime</p>
          <p className="font-mono text-[14px] tabular-nums text-canvas-fg">
            {data ? formatDurationMs(data.uptimeMs) : "—"}
          </p>
        </div>
      </div>

      {/* Firing alerts */}
      {data?.firingAlerts && data.firingAlerts.length > 0 ? (
        <div className="rounded-xl border border-[var(--mon-critical)]/20 bg-[var(--mon-critical)]/5 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--mon-critical)]">
            <FiAlertTriangle size={13} />
            {data.firingAlerts.length} firing alert{data.firingAlerts.length > 1 ? "s" : ""}
          </p>
          <ul className="space-y-1">
            {data.firingAlerts.map((alert) => (
              <li key={alert.id} className="flex items-center justify-between gap-2 text-[11.5px]">
                <span className="truncate font-medium text-canvas-fg">{alert.ruleName}</span>
                <span className="font-mono tabular-nums text-canvas-muted">
                  {alert.observedValue.toFixed(1)} (vs {alert.threshold}) ·{" "}
                  {formatDurationMs(alert.firingForMs)}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setTab("alerts")}
            className="mt-2 text-[11px] font-medium text-[var(--mon-critical)] hover:underline"
          >
            View all alerts →
          </button>
        </div>
      ) : null}

      {/* Key metrics */}
      <SectionGrid minCardWidth={200}>
        {(data?.keyMetrics ?? []).map((m) => (
          <MetricCard
            key={m.id}
            label={m.label}
            value={m.formattedValue}
            unit={m.unit}
            status={m.status}
            sparkline={m.sparkline}
            sparklineDomain={m.unit === "%" ? [0, 100] : "auto"}
          />
        ))}
        {loading && !data
          ? Array.from({ length: 6 }).map((_, i) => (
              <MetricCard key={i} label="Loading…" value={0} loading />
            ))
          : null}
      </SectionGrid>

      {/* Subsystems grid */}
      <div>
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-canvas-muted">
          Subsystems
        </h3>
        <SectionGrid minCardWidth={220}>
          {(data?.subsystems ?? []).map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setTab(s.key)}
              className="rounded-xl border border-canvas-border bg-canvas-bg p-4 text-left transition-colors hover:bg-canvas-surface-hover"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-medium capitalize text-canvas-fg">
                  {labelFor(s.key)}
                </span>
                <StatusBadge status={s.status} size="xs" />
              </div>
              <p className="mt-1 truncate text-[11.5px] text-canvas-muted">{s.summary}</p>
            </button>
          ))}
        </SectionGrid>
      </div>

      {error && !data ? (
        <p className="text-[11px] text-[var(--mon-critical)]">Failed to load: {error.message}</p>
      ) : null}
    </div>
  );
}

function labelFor(key: string): string {
  const map: Record<string, string> = {
    health: "Server Health",
    system: "System",
    processes: "Processes",
    docker: "Docker",
    ws: "WebSockets",
    audit: "Audit",
    cron: "Cron / Reports",
    apm: "Performance",
    logs: "Logs & Errors",
    alerts: "Alerts",
  };
  return map[key] ?? key;
}
