"use client";

import { useCallback, useEffect, useState } from "react";
import { FiPlay, FiPlus, FiRefreshCw, FiTool, FiTrash2 } from "react-icons/fi";
import { authFetch } from "@/lib/auth";
import { formatDurationMs } from "@/lib/monitoring/format";
import type { AutomationRule, AutomationRun } from "@/lib/monitoring/automation/types";
import { useMonContext } from "../monitoring-context";
import { CollapsibleBlock } from "../primitives/collapsible-block";
import { ConfirmActionDialog } from "../primitives/confirm-action-dialog";
import { DataTable } from "../primitives/data-table";
import { EmptyState } from "../primitives/empty-state";
import { StatusBadge } from "../primitives/status-badge";
import { AutomationRuleEditor } from "./automation-rule-editor";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

interface AutomationResponse {
  rules: AutomationRule[];
  runs: AutomationRun[];
}

const KIND_LABEL: Record<string, string> = {
  schedule_prune_docker_logs: "Prune Docker logs",
  schedule_prune_docker_images: "Prune Docker images",
  schedule_trim_audit: "Trim audit retention",
  schedule_trim_cache: "Trim preview cache",
  schedule_trim_heap_snapshots: "Trim heap snapshots",
  schedule_trim_monitoring_history: "Trim metrics history",
  trigger_force_gc: "Auto Force-GC",
  trigger_drop_fs_caches: "Drop FS caches",
  trigger_restart_unhealthy_container: "Restart unhealthy container",
};

export function AutomationSection() {
  const { refreshMs, paused } = useMonContext();
  const [data, setData] = useState<AutomationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AutomationRule | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AutomationRule | null>(null);
  const [confirmRun, setConfirmRun] = useState<AutomationRule | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/monitoring/automation`);
      if (!res.ok) throw new Error(`${res.status}`);
      const json = (await res.json()) as AutomationResponse;
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (paused || !refreshMs) return;
    const timer = setInterval(refresh, Math.max(refreshMs, 5000));
    return () => clearInterval(timer);
  }, [refreshMs, paused, refresh]);

  async function handleToggle(rule: AutomationRule) {
    await authFetch(`${BASE}/api/monitoring/automation/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    void refresh();
  }

  async function handleDelete(id: string) {
    const res = await authFetch(`${BASE}/api/monitoring/automation/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const json = (await res.json()) as { error?: string };
      throw new Error(json.error ?? `${res.status}`);
    }
    void refresh();
  }

  async function handleRunNow(id: string) {
    const res = await authFetch(`${BASE}/api/monitoring/automation/${id}/run`, {
      method: "POST",
    });
    if (!res.ok) {
      const json = (await res.json()) as { error?: string };
      throw new Error(json.error ?? `${res.status}`);
    }
    void refresh();
  }

  async function handleRestoreDefaults() {
    const res = await authFetch(`${BASE}/api/monitoring/automation/restore-defaults`, {
      method: "POST",
    });
    if (!res.ok) throw new Error(`${res.status}`);
    void refresh();
  }

  const enabledCount = data?.rules.filter((r) => r.enabled).length ?? 0;
  const total = data?.rules.length ?? 0;

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <p className="text-[12px] text-canvas-muted">
            {total} rule{total === 1 ? "" : "s"} · {enabledCount} active
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRestoreDefaults}
            className="inline-flex items-center gap-1.5 rounded-md border border-canvas-border px-2.5 py-1.5 text-[11.5px] text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            <FiRefreshCw size={11} />
            Restore defaults
          </button>
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-[11.5px] font-medium text-white transition-colors hover:bg-accent-hover"
          >
            <FiPlus size={11} />
            New rule
          </button>
        </div>
      </div>

      {/* Explainer */}
      <div className="rounded-xl border border-canvas-border bg-canvas-surface-hover/30 p-3 text-[11.5px] text-canvas-muted">
        <p className="font-medium text-canvas-fg">How automation works</p>
        <p className="mt-1">
          Rules either run on a cron schedule (cleanup tasks like trimming logs and pruning Docker
          images) or fire on a sustained metric breach (auto Force-GC under heap pressure,
          restarting unhealthy containers). Three safe rules are enabled by default; the rest are
          disabled until you opt in.
        </p>
      </div>

      {error ? <p className="text-[11px] text-[var(--mon-critical)]">Error: {error}</p> : null}

      {/* Rules table */}
      {data && data.rules.length === 0 ? (
        <EmptyState
          icon={<FiTool size={28} />}
          title="No automation rules configured"
          description="Click 'Restore defaults' to install the safe-default rule set, or 'New rule' to create one from scratch."
        />
      ) : null}

      {data && data.rules.length > 0 ? (
        <CollapsibleBlock title="Rules" description={`${enabledCount} active / ${total} total`}>
          <DataTable<AutomationRule>
            columns={[
              {
                key: "status",
                header: "",
                width: "80px",
                cell: (r) => (
                  <StatusBadge
                    status={
                      r.enabled ? (r.lastRun?.ok === false ? "warning" : "healthy") : "unknown"
                    }
                    size="xs"
                    label={r.enabled ? "On" : "Off"}
                  />
                ),
              },
              {
                key: "name",
                header: "Name",
                sortable: true,
                sortValue: (r) => r.name,
                cell: (r) => (
                  <div className="min-w-0">
                    <p className="truncate font-medium text-canvas-fg">{r.name}</p>
                    <p className="truncate text-[10.5px] text-canvas-muted">
                      {KIND_LABEL[r.kind] ?? r.kind}
                    </p>
                  </div>
                ),
              },
              {
                key: "schedule",
                header: "Schedule / trigger",
                cell: (r) =>
                  r.cron ? (
                    <span className="block truncate font-mono text-[11px] text-canvas-muted">
                      cron {r.cron}
                    </span>
                  ) : r.trigger ? (
                    <span className="block truncate font-mono text-[11px] text-canvas-muted">
                      {r.trigger.metric} {r.trigger.operator} {r.trigger.threshold} ·{" "}
                      {formatDurationMs(r.trigger.forMs)}
                    </span>
                  ) : (
                    <span className="text-canvas-muted">—</span>
                  ),
              },
              {
                key: "lastRun",
                header: "Last run",
                width: "200px",
                cell: (r) => {
                  if (!r.lastRun) return <span className="text-canvas-muted">never</span>;
                  return (
                    <span className="block truncate text-[11px]">
                      <span
                        style={{
                          color: r.lastRun.ok ? "var(--mon-healthy)" : "var(--mon-critical)",
                        }}
                      >
                        {r.lastRun.ok ? "ok" : "fail"}
                      </span>{" "}
                      <span className="text-canvas-muted">{r.lastRun.summary}</span>
                    </span>
                  );
                },
              },
              {
                key: "actions",
                header: "",
                width: "190px",
                align: "right",
                cell: (r) => (
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleToggle(r);
                      }}
                      className="rounded-md border border-canvas-border px-2 py-1 text-[10.5px] text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
                    >
                      {r.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmRun(r);
                      }}
                      className="rounded-md border border-canvas-border px-2 py-1 text-[10.5px] text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
                      title="Run now"
                    >
                      <FiPlay size={10} />
                    </button>
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
        </CollapsibleBlock>
      ) : null}

      {/* Recent runs */}
      {data && data.runs.length > 0 ? (
        <CollapsibleBlock
          title="Recent runs"
          description={`Last ${data.runs.length} runs`}
          defaultOpen={false}
        >
          <DataTable<AutomationRun>
            columns={[
              {
                key: "at",
                header: "When",
                width: "110px",
                cell: (r) => (
                  <span className="text-canvas-muted">
                    {formatDurationMs(Date.now() - r.at)} ago
                  </span>
                ),
              },
              {
                key: "rule",
                header: "Rule",
                cell: (r) => (
                  <span className="block truncate text-[11px] font-medium">{r.ruleName}</span>
                ),
              },
              {
                key: "reason",
                header: "Reason",
                width: "80px",
                cell: (r) => <span className="text-[11px] text-canvas-muted">{r.reason}</span>,
              },
              {
                key: "result",
                header: "Result",
                cell: (r) => (
                  <span className="block truncate text-[11px]">
                    <span
                      style={{
                        color: r.ok ? "var(--mon-healthy)" : "var(--mon-critical)",
                      }}
                    >
                      {r.ok ? "ok" : "fail"}
                    </span>{" "}
                    <span className="text-canvas-muted">{r.summary}</span>
                  </span>
                ),
              },
              {
                key: "duration",
                header: "Duration",
                width: "80px",
                align: "right",
                cell: (r) => (
                  <span className="font-mono tabular-nums text-canvas-muted">
                    {formatDurationMs(r.durationMs)}
                  </span>
                ),
              },
            ]}
            rows={data.runs}
            rowKey={(r) => r.id}
            maxHeight={300}
          />
        </CollapsibleBlock>
      ) : null}

      {editing ? (
        <AutomationRuleEditor
          rule={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      ) : null}

      {confirmDelete ? (
        <ConfirmActionDialog
          title="Delete automation rule"
          description={`Permanently delete the rule "${confirmDelete.name}". This cannot be undone.`}
          confirmText="DELETE"
          auditSubject="monitoring.automation_rule_delete"
          confirmLabel="Delete rule"
          destructive
          onConfirm={async () => {
            await handleDelete(confirmDelete.id);
          }}
          onClose={() => setConfirmDelete(null)}
        />
      ) : null}

      {confirmRun ? (
        <ConfirmActionDialog
          title={`Run now: ${confirmRun.name}`}
          description={`Execute the action immediately, ignoring schedule and cooldown. This will be logged to the audit log.`}
          auditSubject={`monitoring.automation.${confirmRun.kind}`}
          confirmLabel="Run now"
          onConfirm={async () => {
            await handleRunNow(confirmRun.id);
          }}
          onClose={() => setConfirmRun(null)}
        />
      ) : null}
    </div>
  );
}
