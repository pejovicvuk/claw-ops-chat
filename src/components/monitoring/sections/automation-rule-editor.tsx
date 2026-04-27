"use client";

import { useState } from "react";
import { authFetch } from "@/lib/auth";
import type { AutomationRule, RuleKind } from "@/lib/monitoring/automation/types";
import { DetailDrawer } from "../primitives/detail-drawer";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

const KINDS: Array<{ value: RuleKind; label: string; category: "schedule" | "trigger" }> = [
  {
    value: "schedule_prune_docker_logs",
    label: "Prune Docker container logs",
    category: "schedule",
  },
  {
    value: "schedule_prune_docker_images",
    label: "Prune dangling Docker images",
    category: "schedule",
  },
  {
    value: "schedule_trim_audit",
    label: "Trim audit-log retention",
    category: "schedule",
  },
  {
    value: "schedule_trim_cache",
    label: "Trim preview / proxy cache",
    category: "schedule",
  },
  {
    value: "schedule_trim_heap_snapshots",
    label: "Trim heap snapshots",
    category: "schedule",
  },
  {
    value: "schedule_trim_monitoring_history",
    label: "Trim long-term metrics history",
    category: "schedule",
  },
  { value: "trigger_force_gc", label: "Auto Force-GC on heap pressure", category: "trigger" },
  {
    value: "trigger_drop_fs_caches",
    label: "Drop FS caches under memory pressure",
    category: "trigger",
  },
  {
    value: "trigger_restart_unhealthy_container",
    label: "Restart unhealthy Docker containers",
    category: "trigger",
  },
];

interface AutomationRuleEditorProps {
  rule: AutomationRule | null;
  onClose: () => void;
  onSaved: () => void;
}

export function AutomationRuleEditor({ rule, onClose, onSaved }: AutomationRuleEditorProps) {
  const [name, setName] = useState(rule?.name ?? "");
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [kind, setKind] = useState<RuleKind>(rule?.kind ?? KINDS[0].value);
  const [cron, setCron] = useState(rule?.cron ?? "0 4 * * *");
  const [triggerMetric, setTriggerMetric] = useState(
    rule?.trigger?.metric ?? "health.memory.heapUsedPct",
  );
  const [triggerOperator, setTriggerOperator] = useState<">" | "<" | ">=" | "<=" | "==">(
    rule?.trigger?.operator ?? ">",
  );
  const [triggerThreshold, setTriggerThreshold] = useState(String(rule?.trigger?.threshold ?? 90));
  const [triggerForMin, setTriggerForMin] = useState(
    String(rule ? (rule.trigger?.forMs ?? 120000) / 60_000 : 2),
  );
  const [cooldownMin, setCooldownMin] = useState(String(rule ? rule.cooldownMs / 60_000 : 10));
  const [optionsJson, setOptionsJson] = useState(JSON.stringify(rule?.options ?? {}, null, 2));
  const [runbookUrl, setRunbookUrl] = useState(rule?.runbookUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const category = KINDS.find((k) => k.value === kind)?.category ?? "schedule";

  async function save() {
    setBusy(true);
    setError(null);
    let options: Record<string, unknown> = {};
    try {
      options = JSON.parse(optionsJson || "{}") as Record<string, unknown>;
    } catch (err) {
      setError(`options is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
      setBusy(false);
      return;
    }
    const body: Record<string, unknown> = {
      name: name.trim(),
      kind,
      enabled,
      cooldownMs: Math.round(Number(cooldownMin) * 60_000),
      options,
      runbookUrl: runbookUrl.trim() || undefined,
    };
    if (category === "schedule") {
      body.cron = cron.trim();
    } else {
      const threshold = Number(triggerThreshold);
      if (!Number.isFinite(threshold)) {
        setError("Trigger threshold must be a number");
        setBusy(false);
        return;
      }
      body.trigger = {
        metric: triggerMetric.trim(),
        operator: triggerOperator,
        threshold,
        forMs: Math.round(Number(triggerForMin) * 60_000),
      };
    }
    try {
      const url = rule
        ? `${BASE}/api/monitoring/automation/${rule.id}`
        : `${BASE}/api/monitoring/automation`;
      const res = await authFetch(url, {
        method: rule ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `${res.status}`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DetailDrawer
      title={rule ? "Edit automation rule" : "New automation rule"}
      onClose={onClose}
      actions={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-canvas-border px-3 py-1.5 text-[12px] text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-hover disabled:opacity-40"
          >
            {busy ? "Saving…" : rule ? "Save" : "Create"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Weekly Docker log pruning"
            className="block w-full rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 text-[12.5px] text-canvas-fg outline-none focus:border-accent"
          />
        </Field>
        <label className="flex items-center gap-2 text-[12.5px] text-canvas-fg">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
        <Field label="Action">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as RuleKind)}
            className="block w-full rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 text-[12.5px] text-canvas-fg outline-none focus:border-accent"
          >
            <optgroup label="Scheduled">
              {KINDS.filter((k) => k.category === "schedule").map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Triggered">
              {KINDS.filter((k) => k.category === "trigger").map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </optgroup>
          </select>
        </Field>
        {category === "schedule" ? (
          <Field label="Cron expression (UTC)">
            <input
              type="text"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder="0 4 * * *"
              className="block w-full rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[12px] text-canvas-fg outline-none focus:border-accent"
            />
            <p className="mt-1 text-[10.5px] text-canvas-muted">
              5 fields: min hr dom mon dow. e.g. <code>0 4 * * *</code> = daily 04:00 UTC.
            </p>
          </Field>
        ) : (
          <>
            <Field label="Trigger metric">
              <input
                type="text"
                value={triggerMetric}
                onChange={(e) => setTriggerMetric(e.target.value)}
                className="block w-full rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[12px] text-canvas-fg outline-none focus:border-accent"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Operator">
                <select
                  value={triggerOperator}
                  onChange={(e) =>
                    setTriggerOperator(e.target.value as ">" | "<" | ">=" | "<=" | "==")
                  }
                  className="block w-full rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 text-[12.5px] text-canvas-fg outline-none focus:border-accent"
                >
                  {[">", "<", ">=", "<=", "=="].map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Threshold">
                <input
                  type="number"
                  value={triggerThreshold}
                  onChange={(e) => setTriggerThreshold(e.target.value)}
                  className="block w-full rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[12.5px] text-canvas-fg outline-none focus:border-accent"
                />
              </Field>
            </div>
            <Field label="Sustained for (minutes)">
              <input
                type="number"
                min={0}
                step={0.5}
                value={triggerForMin}
                onChange={(e) => setTriggerForMin(e.target.value)}
                className="block w-full rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[12.5px] text-canvas-fg outline-none focus:border-accent"
              />
            </Field>
          </>
        )}
        <Field label="Cooldown (minutes)">
          <input
            type="number"
            min={0}
            step={1}
            value={cooldownMin}
            onChange={(e) => setCooldownMin(e.target.value)}
            className="block w-full rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[12.5px] text-canvas-fg outline-none focus:border-accent"
          />
        </Field>
        <Field label="Options (JSON)">
          <textarea
            value={optionsJson}
            onChange={(e) => setOptionsJson(e.target.value)}
            rows={5}
            className="block w-full resize-y rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[11.5px] text-canvas-fg outline-none focus:border-accent"
          />
          <p className="mt-1 text-[10.5px] text-canvas-muted">
            Action-specific options. e.g. <code>{`{"maxAgeDays": 30}`}</code> for retention rules.
          </p>
        </Field>
        <Field label="Runbook URL (optional)">
          <input
            type="url"
            value={runbookUrl}
            onChange={(e) => setRunbookUrl(e.target.value)}
            placeholder="https://wiki.example.com/runbooks/docker-pruning"
            className="block w-full rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 text-[12px] text-canvas-fg outline-none focus:border-accent"
          />
        </Field>
        {error ? <p className="text-[11.5px] text-[var(--mon-critical)]">{error}</p> : null}
      </div>
    </DetailDrawer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-canvas-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
