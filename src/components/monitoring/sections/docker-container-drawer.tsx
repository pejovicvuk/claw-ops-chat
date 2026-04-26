"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth";
import { formatBytes, formatDurationMs, formatPercent } from "@/lib/monitoring/format";
import type { DockerContainerRow } from "@/lib/monitoring/types";
import { useMonContext } from "../monitoring-context";
import { ConfirmActionDialog } from "../primitives/confirm-action-dialog";
import { DetailDrawer } from "../primitives/detail-drawer";
import { MetricCard } from "../primitives/metric-card";
import { SectionGrid } from "../primitives/section-grid";
import { Sparkline } from "../primitives/sparkline";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

function uptimeOf(startedAt: number | null): string {
  return startedAt ? formatDurationMs(Date.now() - startedAt) : "—";
}

interface DockerContainerDrawerProps {
  container: DockerContainerRow;
  onClose: () => void;
}

export function DockerContainerDrawer({ container, onClose }: DockerContainerDrawerProps) {
  const { subTab, setSubTab } = useMonContext();
  const tab = (subTab ?? "metrics") as "metrics" | "logs" | "inspect";
  const [logsState, setLogsState] = useState<{
    lines: string[];
    loading: boolean;
    error: string | null;
  }>({ lines: [], loading: false, error: null });
  const [confirmAction, setConfirmAction] = useState<
    null | "stop" | "restart" | "start" | "pause" | "unpause"
  >(null);

  useEffect(() => {
    if (tab !== "logs") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await authFetch(`${BASE}/api/monitoring/docker/${container.id}/logs?tail=200`);
        if (!res.ok) throw new Error(`${res.status}`);
        const json = (await res.json()) as { lines: string[] };
        if (!cancelled) {
          setLogsState({ lines: json.lines, loading: false, error: null });
        }
      } catch (err) {
        if (!cancelled) {
          setLogsState({
            lines: [],
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, container.id]);

  async function performAction(action: "stop" | "restart" | "start" | "pause" | "unpause") {
    const res = await authFetch(`${BASE}/api/monitoring/docker/${container.id}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? `${res.status}`);
  }

  return (
    <>
      <DetailDrawer
        title={container.name}
        subtitle={container.image}
        status={container.status === "running" ? "healthy" : "unknown"}
        tabs={[
          { key: "metrics", label: "Metrics" },
          { key: "logs", label: "Logs" },
          { key: "inspect", label: "Inspect" },
        ]}
        activeTab={tab}
        onTabChange={(k) => setSubTab(k)}
        onClose={onClose}
        actions={
          container.status === "running" ? (
            <>
              <button
                type="button"
                onClick={() => setConfirmAction("restart")}
                className="rounded-md border border-canvas-border px-2.5 py-1.5 text-[11.5px] text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
              >
                Restart
              </button>
              <button
                type="button"
                onClick={() => setConfirmAction("stop")}
                className="rounded-md border border-[var(--mon-warning)]/30 bg-[var(--mon-warning)]/10 px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--mon-warning)] transition-colors hover:bg-[var(--mon-warning)]/20"
              >
                Stop
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmAction("start")}
              className="rounded-md border border-canvas-border bg-[var(--mon-healthy)]/10 px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--mon-healthy)] transition-colors hover:bg-[var(--mon-healthy)]/20"
            >
              Start
            </button>
          )
        }
      >
        {tab === "metrics" ? (
          <div className="space-y-3">
            <SectionGrid minCardWidth={140}>
              <MetricCard
                label="CPU"
                value={formatPercent(container.cpuPct)}
                sparkline={container.cpuSeries}
              />
              <MetricCard
                label="Memory"
                value={formatBytes(container.memBytes)}
                unit={
                  container.memLimitBytes > 0 ? `/ ${formatBytes(container.memLimitBytes)}` : ""
                }
                sparkline={container.memSeries}
              />
              <MetricCard label="Restarts" value={container.restartCount} />
              <MetricCard label="Uptime" value={uptimeOf(container.startedAt)} />
            </SectionGrid>
            <div className="rounded-xl border border-canvas-border bg-canvas-bg p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
                CPU history
              </p>
              <Sparkline
                values={container.cpuSeries}
                width={400}
                height={60}
                ariaLabel="CPU history"
              />
            </div>
            <div className="rounded-xl border border-canvas-border bg-canvas-bg p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
                Ports
              </p>
              {container.ports.length === 0 ? (
                <p className="text-[11.5px] text-canvas-muted">No exposed ports</p>
              ) : (
                <ul className="space-y-1 text-[11.5px]">
                  {container.ports.map((p, i) => (
                    <li key={i} className="font-mono text-canvas-fg">
                      {p.host ? `${p.host} → ` : ""}
                      {p.container}/{p.proto}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}

        {tab === "logs" ? (
          <div className="space-y-2">
            <p className="text-[11px] text-canvas-muted">Last 200 lines</p>
            {logsState.loading ? <p className="text-[11px] text-canvas-muted">Loading…</p> : null}
            {logsState.error ? (
              <p className="text-[11px] text-[var(--mon-critical)]">Error: {logsState.error}</p>
            ) : null}
            <pre className="overflow-x-auto rounded-md bg-canvas-surface p-2 font-mono text-[10.5px] leading-relaxed text-canvas-fg">
              {logsState.lines.join("\n")}
            </pre>
          </div>
        ) : null}

        {tab === "inspect" ? (
          <div className="rounded-md bg-canvas-surface p-3 font-mono text-[10.5px] text-canvas-muted">
            <p className="mb-1 font-semibold text-canvas-fg">ID</p>
            <p className="break-all">{container.id}</p>
            <p className="mt-2 mb-1 font-semibold text-canvas-fg">Started</p>
            <p>{container.startedAt ? new Date(container.startedAt).toISOString() : "—"}</p>
            <p className="mt-2 mb-1 font-semibold text-canvas-fg">Status / health</p>
            <p>
              {container.status} / {container.health}
            </p>
          </div>
        ) : null}
      </DetailDrawer>

      {confirmAction ? (
        <ConfirmActionDialog
          title={`${capitalize(confirmAction)} container`}
          description={`This will ${confirmAction} ${container.name}. Other services that depend on it may be affected.`}
          auditSubject={`monitoring.docker_${confirmAction}`}
          confirmLabel={capitalize(confirmAction)}
          destructive={confirmAction === "stop"}
          onConfirm={async () => {
            await performAction(confirmAction);
          }}
          onClose={() => setConfirmAction(null)}
        />
      ) : null}
    </>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
