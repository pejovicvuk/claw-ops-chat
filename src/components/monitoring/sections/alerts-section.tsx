"use client";

import { useEffect, useState } from "react";
import { FiBell, FiPause, FiPlus, FiTrash2 } from "react-icons/fi";
import { authFetch } from "@/lib/auth";
import { formatDurationMs } from "@/lib/monitoring/format";
import type { AlertEvent, AlertRule } from "@/lib/monitoring/types";
import { useMonContext } from "../monitoring-context";
import { ConfirmActionDialog } from "../primitives/confirm-action-dialog";
import { DataTable } from "../primitives/data-table";
import { EmptyState } from "../primitives/empty-state";
import { StatusBadge } from "../primitives/status-badge";
import { AlertRuleEditor } from "./alert-rule-editor";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

function firingForLabel(at: number): string {
  return formatDurationMs(Date.now() - at);
}

interface AlertsResponse {
  rules: AlertRule[];
  firing: AlertEvent[];
  knownMetrics: string[];
}

export function AlertsSection() {
  const { refreshMs, paused } = useMonContext();
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AlertRule | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AlertRule | null>(null);
  const [selectedFiring, setSelectedFiring] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await authFetch(`${BASE}/api/monitoring/alerts`);
        if (!res.ok) throw new Error(`${res.status}`);
        const json = (await res.json()) as AlertsResponse;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void refresh();
    if (paused || !refreshMs) return () => {};
    const timer = setInterval(refresh, Math.max(refreshMs, 5000));
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refreshMs, paused]);

  async function handleSnooze(id: string) {
    await authFetch(`${BASE}/api/monitoring/alerts/${id}/snooze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ forMs: 60 * 60 * 1000 }),
    });
  }

  async function handleBulk(action: "ack" | "snooze") {
    if (selectedFiring.size === 0) return;
    const ruleIds = [...selectedFiring];
    await authFetch(`${BASE}/api/monitoring/alerts/bulk-ack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ruleIds,
        action,
        forMs: action === "snooze" ? 60 * 60 * 1000 : undefined,
      }),
    });
    setSelectedFiring(new Set());
  }

  async function handleDelete(id: string) {
    const res = await authFetch(`${BASE}/api/monitoring/alerts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = (await res.json()) as { error?: string };
      throw new Error(json.error ?? `${res.status}`);
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-canvas-muted">
          {data?.rules.length ?? 0} rule{(data?.rules.length ?? 0) === 1 ? "" : "s"} ·{" "}
          <span className={data?.firing.length ? "text-[var(--mon-critical)]" : ""}>
            {data?.firing.length ?? 0} firing
          </span>
        </p>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-[11.5px] font-medium text-white transition-colors hover:bg-accent-hover"
        >
          <FiPlus size={11} />
          New rule
        </button>
      </div>

      {error ? <p className="text-[11px] text-[var(--mon-critical)]">Error: {error}</p> : null}

      {data?.firing.length ? (
        <div className="space-y-2">
          {selectedFiring.size > 0 ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-canvas-border bg-canvas-surface-hover/50 px-3 py-2 text-[11.5px]">
              <span className="text-canvas-muted">{selectedFiring.size} selected</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleBulk("snooze")}
                  className="inline-flex items-center gap-1 rounded-md border border-canvas-border px-2 py-1 text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
                >
                  <FiPause size={10} /> Snooze 1h
                </button>
                <button
                  type="button"
                  onClick={() => void handleBulk("ack")}
                  className="rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-accent-hover"
                >
                  Acknowledge
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedFiring(new Set())}
                  className="text-canvas-muted hover:text-canvas-fg"
                >
                  Clear
                </button>
              </div>
            </div>
          ) : null}
          {data.firing.map((event) => {
            const isSelected = selectedFiring.has(event.ruleId);
            return (
              <div
                key={event.id}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 transition-colors ${
                  isSelected
                    ? "border-[var(--mon-critical)]/50 bg-[var(--mon-critical)]/10"
                    : "border-[var(--mon-critical)]/30 bg-[var(--mon-critical)]/5"
                }`}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => {
                      const next = new Set(selectedFiring);
                      if (e.target.checked) next.add(event.ruleId);
                      else next.delete(event.ruleId);
                      setSelectedFiring(next);
                    }}
                    className="mt-0.5"
                    aria-label={`Select ${event.ruleName}`}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <FiBell className="text-[var(--mon-critical)]" />
                      <span className="font-medium text-canvas-fg">{event.ruleName}</span>
                      <StatusBadge
                        status={event.severity === "critical" ? "critical" : "warning"}
                        size="xs"
                      />
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-canvas-muted">
                      Observed {event.observedValue.toFixed(1)} (threshold {event.threshold}) ·
                      firing {firingForLabel(event.firedAt)}
                    </p>
                    {event.runbookUrl ? (
                      <a
                        href={event.runbookUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-0.5 inline-block text-[11px] font-medium text-[var(--mon-info)] hover:underline"
                      >
                        Open runbook →
                      </a>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleSnooze(event.ruleId)}
                  className="inline-flex items-center gap-1 rounded-md border border-canvas-border px-2 py-1 text-[11px] text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
                >
                  <FiPause size={10} /> Snooze 1h
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {data && data.rules.length === 0 ? (
        <EmptyState
          icon={<FiBell size={28} />}
          title="No alerts configured"
          description="Create rules to be notified when metrics cross thresholds. Notifications go to your subscribed devices via Web Push."
          action={
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-[12px] font-medium text-white"
            >
              <FiPlus size={12} />
              Create your first alert
            </button>
          }
        />
      ) : null}

      {data && data.rules.length > 0 ? (
        <DataTable<AlertRule>
          columns={[
            {
              key: "status",
              header: "",
              width: "70px",
              cell: (r) => (
                <StatusBadge
                  status={
                    !r.enabled
                      ? "unknown"
                      : data.firing.some((f) => f.ruleId === r.id)
                        ? "critical"
                        : "healthy"
                  }
                  size="xs"
                  label={
                    !r.enabled
                      ? "Off"
                      : data.firing.some((f) => f.ruleId === r.id)
                        ? "Firing"
                        : "OK"
                  }
                />
              ),
            },
            {
              key: "name",
              header: "Name",
              sortable: true,
              sortValue: (r) => r.name,
              cell: (r) => <span className="font-medium">{r.name}</span>,
            },
            {
              key: "metric",
              header: "Metric",
              cell: (r) => (
                <span className="block truncate font-mono text-[11px] text-canvas-muted">
                  {r.metric}
                </span>
              ),
            },
            {
              key: "threshold",
              header: "Threshold",
              width: "150px",
              cell: (r) => (
                <span className="font-mono text-[11.5px]">
                  {r.operator} {r.threshold}{" "}
                  <span className="text-canvas-muted">for {formatDurationMs(r.forMs)}</span>
                </span>
              ),
            },
            {
              key: "severity",
              header: "Severity",
              width: "90px",
              cell: (r) => (
                <span
                  style={{
                    color: r.severity === "critical" ? "var(--mon-critical)" : "var(--mon-warning)",
                  }}
                  className="font-medium"
                >
                  {r.severity}
                </span>
              ),
            },
            {
              key: "actions",
              header: "",
              width: "120px",
              align: "right",
              cell: (r) => (
                <div className="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(r);
                    }}
                    className="rounded-md border border-canvas-border px-2 py-1 text-[10.5px] text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(r);
                    }}
                    className="rounded-md border border-canvas-border px-2 py-1 text-[10.5px] text-canvas-muted hover:bg-[var(--mon-critical)]/10 hover:text-[var(--mon-critical)]"
                  >
                    <FiTrash2 size={10} />
                  </button>
                </div>
              ),
            },
          ]}
          rows={data.rules}
          rowKey={(r) => r.id}
          maxHeight={500}
        />
      ) : null}

      {editing ? (
        <AlertRuleEditor
          rule={editing === "new" ? null : editing}
          knownMetrics={data?.knownMetrics ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            // Trigger refresh on next tick.
          }}
        />
      ) : null}

      {confirmDelete ? (
        <ConfirmActionDialog
          title="Delete alert rule"
          description={`Permanently delete the rule "${confirmDelete.name}".`}
          confirmText="DELETE"
          auditSubject="monitoring.alert_rule_delete"
          confirmLabel="Delete rule"
          destructive
          onConfirm={async () => {
            await handleDelete(confirmDelete.id);
          }}
          onClose={() => setConfirmDelete(null)}
        />
      ) : null}
    </div>
  );
}
