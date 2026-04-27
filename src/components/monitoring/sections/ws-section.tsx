"use client";

import { useState } from "react";
import { authFetch } from "@/lib/auth";
import { ScopedAuditDrawer } from "@/components/audit/scoped-audit-drawer";
import { useMonPoll } from "@/lib/monitoring/use-mon-poll";
import { formatBytes, formatDurationMs, formatRate } from "@/lib/monitoring/format";

function uptimeOf(connectedAt: number | null): string {
  return connectedAt ? formatDurationMs(Date.now() - connectedAt) : "—";
}
import type { WsSessionRow, WsSnapshot } from "@/lib/monitoring/types";
import { useMonContext } from "../monitoring-context";
import { ConfirmActionDialog } from "../primitives/confirm-action-dialog";
import { DataTable } from "../primitives/data-table";
import { DetailDrawer } from "../primitives/detail-drawer";
import { MetricCard } from "../primitives/metric-card";
import { SectionGrid } from "../primitives/section-grid";
import { Sparkline } from "../primitives/sparkline";
import { StatusBadge } from "../primitives/status-badge";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

export function WsSection() {
  const { refreshMs, paused } = useMonContext();
  const { data, error } = useMonPoll<WsSnapshot>("/api/monitoring/ws", {
    intervalMs: refreshMs,
    paused,
  });
  const [confirmDisconnect, setConfirmDisconnect] = useState<WsSessionRow | null>(null);
  const [activityFor, setActivityFor] = useState<WsSessionRow | null>(null);

  if (error && !data) {
    return <p className="p-4 text-[12px] text-[var(--mon-critical)]">Error: {error.message}</p>;
  }

  return (
    <div className="space-y-4 p-4">
      <SectionGrid minCardWidth={180}>
        <MetricCard
          label="Active sessions"
          value={data?.active ?? "—"}
          sparkline={data?.series.active}
          status={(data?.active ?? 0) > 0 ? "healthy" : "info"}
        />
        <MetricCard
          label="Msgs / sec in"
          value={data ? formatRate(data.msgsInPerSec) : "—"}
          sparkline={data?.series.msgsInPerSec}
        />
        <MetricCard
          label="Msgs / sec out"
          value={data ? formatRate(data.msgsOutPerSec) : "—"}
          sparkline={data?.series.msgsOutPerSec}
        />
        <MetricCard label="Total ever" value={data?.totalEverConnected ?? "—"} />
      </SectionGrid>

      <DataTable<WsSessionRow>
        columns={[
          {
            key: "state",
            header: "State",
            width: "110px",
            cell: (s) => (
              <StatusBadge
                status={
                  s.state === "busy" || s.state === "awaiting_permission"
                    ? "warning"
                    : s.state === "idle"
                      ? "healthy"
                      : "unknown"
                }
                size="xs"
                label={s.state.replace(/_/g, " ")}
              />
            ),
          },
          {
            key: "id",
            header: "Session",
            sortable: true,
            sortValue: (s) => s.id,
            cell: (s) => <span className="font-mono text-[11px]">{s.id.slice(0, 12)}</span>,
          },
          {
            key: "client",
            header: "Client",
            cell: (s) => (
              <span className="block truncate text-canvas-muted" title={s.client}>
                {s.client ?? s.ip ?? "—"}
              </span>
            ),
          },
          {
            key: "tabs",
            header: "Tabs",
            width: "60px",
            align: "right",
            sortable: true,
            sortValue: (s) => s.clientCount,
            cell: (s) => <span className="font-mono">{s.clientCount}</span>,
          },
          {
            key: "queue",
            header: "Queue",
            width: "60px",
            align: "right",
            sortable: true,
            sortValue: (s) => s.queueDepth,
            cell: (s) => <span className="font-mono">{s.queueDepth}</span>,
          },
          {
            key: "in",
            header: "In/s",
            width: "100px",
            cell: (s) => <Sparkline values={s.msgsInSeries} ariaLabel={`${s.id} msgs in`} />,
          },
          {
            key: "out",
            header: "Out/s",
            width: "100px",
            cell: (s) => <Sparkline values={s.msgsOutSeries} ariaLabel={`${s.id} msgs out`} />,
          },
          {
            key: "bytes",
            header: "Bytes",
            width: "120px",
            align: "right",
            sortable: true,
            sortValue: (s) => s.bytesIn + s.bytesOut,
            cell: (s) => (
              <span className="font-mono tabular-nums text-canvas-muted">
                {formatBytes(s.bytesIn)} / {formatBytes(s.bytesOut)}
              </span>
            ),
          },
          {
            key: "uptime",
            header: "Up",
            width: "80px",
            align: "right",
            sortable: true,
            sortValue: (s) => s.connectedAt ?? 0,
            cell: (s) => (
              <span className="font-mono tabular-nums text-canvas-muted">
                {uptimeOf(s.connectedAt)}
              </span>
            ),
          },
          {
            key: "actions",
            header: "",
            width: "100px",
            align: "right",
            cell: (s) => (
              <div className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActivityFor(s);
                  }}
                  className="rounded-md border border-canvas-border px-2 py-1 text-[10.5px] text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
                >
                  Activity
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDisconnect(s);
                  }}
                  className="rounded-md border border-canvas-border px-2 py-1 text-[10.5px] text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
                >
                  Disconnect
                </button>
              </div>
            ),
          },
        ]}
        rows={data?.sessions ?? []}
        rowKey={(s) => s.id}
        defaultSort={{ key: "uptime", dir: "desc" }}
        empty="No active WebSocket connections"
        maxHeight={500}
      />

      {activityFor ? (
        <DetailDrawer
          title={`Session ${activityFor.id.slice(0, 12)}`}
          subtitle={activityFor.client ?? activityFor.ip}
          status={
            activityFor.state === "busy" || activityFor.state === "awaiting_permission"
              ? "warning"
              : activityFor.state === "idle"
                ? "healthy"
                : "unknown"
          }
          onClose={() => setActivityFor(null)}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-[11.5px]">
              <div>
                <p className="text-canvas-muted">Connected at</p>
                <p className="font-mono text-canvas-fg">
                  {activityFor.connectedAt
                    ? new Date(activityFor.connectedAt).toLocaleString()
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-canvas-muted">Last activity</p>
                <p className="font-mono text-canvas-fg">
                  {new Date(activityFor.lastActivityAt).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-canvas-muted">Bytes in / out</p>
                <p className="font-mono text-canvas-fg">
                  {formatBytes(activityFor.bytesIn)} / {formatBytes(activityFor.bytesOut)}
                </p>
              </div>
              <div>
                <p className="text-canvas-muted">Messages in / out</p>
                <p className="font-mono text-canvas-fg">
                  {activityFor.msgsIn.toLocaleString()} / {activityFor.msgsOut.toLocaleString()}
                </p>
              </div>
            </div>
            <ScopedAuditDrawer
              filter={{ q: activityFor.id, category: ["session", "api"] }}
              description="Audit events scoped to this WebSocket session id."
              limit={50}
            />
          </div>
        </DetailDrawer>
      ) : null}

      {confirmDisconnect ? (
        <ConfirmActionDialog
          title="Force-disconnect session"
          description={`This will close the WebSocket for session ${confirmDisconnect.id.slice(0, 12)}. Connected tabs will reconnect within a few seconds.`}
          auditSubject="monitoring.ws_disconnect"
          confirmLabel="Disconnect"
          destructive
          onConfirm={async () => {
            const res = await authFetch(
              `${BASE}/api/monitoring/ws/${confirmDisconnect.id}/disconnect`,
              { method: "POST" },
            );
            const json = (await res.json()) as { error?: string };
            if (!res.ok) throw new Error(json.error ?? `${res.status}`);
          }}
          onClose={() => setConfirmDisconnect(null)}
        />
      ) : null}
    </div>
  );
}
