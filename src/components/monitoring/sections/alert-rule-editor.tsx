"use client";

import { useState } from "react";
import { authFetch } from "@/lib/auth";
import type { AlertOperator, AlertRule, AlertSeverity } from "@/lib/monitoring/types";
import { DetailDrawer } from "../primitives/detail-drawer";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

const OPERATORS: AlertOperator[] = [">", "<", ">=", "<=", "=="];

interface AlertRuleEditorProps {
  rule: AlertRule | null;
  knownMetrics: string[];
  onClose: () => void;
  onSaved: () => void;
}

export function AlertRuleEditor({ rule, knownMetrics, onClose, onSaved }: AlertRuleEditorProps) {
  const [name, setName] = useState(rule?.name ?? "");
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [metric, setMetric] = useState(rule?.metric ?? knownMetrics[0] ?? "");
  const [operator, setOperator] = useState<AlertOperator>(rule?.operator ?? ">");
  const [threshold, setThreshold] = useState(String(rule?.threshold ?? ""));
  const [forMin, setForMin] = useState(String(rule ? rule.forMs / 60_000 : 5));
  const [severity, setSeverity] = useState<AlertSeverity>(rule?.severity ?? "warning");
  const [webPush, setWebPush] = useState(rule?.notify.webPush ?? true);
  const [webhookUrl, setWebhookUrl] = useState(rule?.notify.webhook?.url ?? "");
  const [runbookUrl, setRunbookUrl] = useState(rule?.runbookUrl ?? "");
  const [customMetric, setCustomMetric] = useState(
    rule?.metric && !knownMetrics.includes(rule.metric) ? rule.metric : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveMetric = customMetric.trim() || metric;

  async function save() {
    setBusy(true);
    setError(null);
    const body = {
      name: name.trim(),
      enabled,
      metric: effectiveMetric,
      operator,
      threshold: Number(threshold),
      forMs: Math.round(Number(forMin) * 60_000),
      severity,
      notify: {
        webPush,
        webhook: webhookUrl.trim() ? { url: webhookUrl.trim() } : undefined,
      },
      runbookUrl: runbookUrl.trim() || undefined,
    };
    if (!body.name) {
      setError("Name required");
      setBusy(false);
      return;
    }
    if (!Number.isFinite(body.threshold)) {
      setError("Threshold must be a number");
      setBusy(false);
      return;
    }
    try {
      const url = rule
        ? `${BASE}/api/monitoring/alerts/${rule.id}`
        : `${BASE}/api/monitoring/alerts`;
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
      title={rule ? "Edit alert rule" : "New alert rule"}
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
            placeholder="e.g. CPU saturation"
            className="block w-full rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 text-[12.5px] text-canvas-fg outline-none focus:border-accent"
          />
        </Field>
        <label className="flex items-center gap-2 text-[12.5px] text-canvas-fg">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
        <Field label="Metric">
          <select
            value={metric}
            onChange={(e) => {
              setMetric(e.target.value);
              setCustomMetric("");
            }}
            disabled={Boolean(customMetric.trim())}
            className="block w-full rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[12px] text-canvas-fg outline-none focus:border-accent disabled:opacity-50"
          >
            {knownMetrics.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={customMetric}
            onChange={(e) => setCustomMetric(e.target.value)}
            placeholder="…or type custom metric (e.g. audit.count(category=api,severity=error,window=60s))"
            className="mt-1 block w-full rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[11px] text-canvas-fg outline-none focus:border-accent"
          />
          <p className="mt-1 text-[10.5px] text-canvas-muted">
            Use <code>audit.count(...)</code> to fire on patterns like &ldquo;5 errors /
            minute&rdquo;.
          </p>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Operator">
            <select
              value={operator}
              onChange={(e) => setOperator(e.target.value as AlertOperator)}
              className="block w-full rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 text-[12.5px] text-canvas-fg outline-none focus:border-accent"
            >
              {OPERATORS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Threshold">
            <input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="block w-full rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[12.5px] text-canvas-fg outline-none focus:border-accent"
            />
          </Field>
        </div>
        <Field label="Sustained for (minutes)">
          <input
            type="number"
            min={0}
            step={0.5}
            value={forMin}
            onChange={(e) => setForMin(e.target.value)}
            className="block w-full rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[12.5px] text-canvas-fg outline-none focus:border-accent"
          />
        </Field>
        <Field label="Severity">
          <div className="flex gap-2">
            {(["warning", "critical"] as AlertSeverity[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSeverity(s)}
                className={`flex-1 rounded-md border px-3 py-2 text-[12px] font-medium transition-colors ${
                  severity === s
                    ? s === "critical"
                      ? "border-[var(--mon-critical)]/40 bg-[var(--mon-critical)]/10 text-[var(--mon-critical)]"
                      : "border-[var(--mon-warning)]/40 bg-[var(--mon-warning)]/10 text-[var(--mon-warning)]"
                    : "border-canvas-border text-canvas-muted hover:bg-canvas-surface-hover"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Notify">
          <label className="flex items-center gap-2 text-[12.5px] text-canvas-fg">
            <input
              type="checkbox"
              checked={webPush}
              onChange={(e) => setWebPush(e.target.checked)}
            />
            Web Push (sends to all subscribed devices)
          </label>
        </Field>
        <Field label="Webhook URL (optional)">
          <input
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/... or https://events.pagerduty.com/v2/enqueue"
            className="block w-full rounded-md border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[11.5px] text-canvas-fg outline-none focus:border-accent"
          />
          <p className="mt-1 text-[10.5px] text-canvas-muted">
            POSTs JSON envelope to this URL on fire / resolve. SSRF-guarded against private IPs.
          </p>
        </Field>
        <Field label="Runbook URL (optional)">
          <input
            type="url"
            value={runbookUrl}
            onChange={(e) => setRunbookUrl(e.target.value)}
            placeholder="https://wiki.example.com/runbooks/cpu-saturation"
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
