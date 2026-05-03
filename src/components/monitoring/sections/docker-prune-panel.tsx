"use client";

import { useCallback, useState } from "react";
import { FiTrash2 } from "react-icons/fi";

import { authFetch } from "@/lib/auth";
import { formatBytes, formatDurationMs } from "@/lib/monitoring/format";
import type { DockerPruneConfig } from "@/lib/monitoring/docker-prune";

import { useMonPoll } from "@/lib/monitoring/use-mon-poll";
import { ConfirmActionDialog } from "../primitives/confirm-action-dialog";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";
const INTERVAL_PRESETS = [1, 3, 7, 14, 30] as const;

interface PruneRunResult {
  bytesFreed: number;
  containers: number;
  images: number;
  networks: number;
  builder: number;
  errors: string[];
}

export function DockerPrunePanel(): React.ReactElement {
  const { data, refresh } = useMonPoll<DockerPruneConfig>("/api/monitoring/docker/prune", {
    intervalMs: 30_000,
  });
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [customDays, setCustomDays] = useState<string>("");

  const updateConfig = useCallback(
    async (patch: Partial<Pick<DockerPruneConfig, "enabled" | "intervalDays">>) => {
      setBusy(true);
      try {
        const res = await authFetch(`${BASE}/api/monitoring/docker/prune`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(json.error ?? `${res.status}`);
        }
        await refresh();
      } catch (err) {
        setFlash({
          ok: false,
          text: err instanceof Error ? err.message : "Update failed",
        });
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const runPrune = useCallback(async () => {
    const res = await authFetch(`${BASE}/api/monitoring/docker/prune/run`, { method: "POST" });
    const json = (await res.json()) as PruneRunResult & { error?: string };
    if (!res.ok) throw new Error(json.error ?? `${res.status}`);
    setFlash({
      ok: json.errors.length === 0,
      text:
        json.errors.length === 0
          ? `Freed ${formatBytes(json.bytesFreed)}.`
          : `Freed ${formatBytes(json.bytesFreed)}, with errors: ${json.errors.join("; ")}`,
    });
    await refresh();
  }, [refresh]);

  const config = data;
  const enabled = config?.enabled ?? true;
  const intervalDays = config?.intervalDays ?? 7;
  const lastRunLabel = config?.lastRunAt
    ? `${formatDurationMs(Date.now() - config.lastRunAt)} ago`
    : "never";

  return (
    <>
      <div className="rounded-xl border border-canvas-border bg-canvas-bg p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FiTrash2 size={14} className="text-canvas-muted" />
            <h3 className="text-[12.5px] font-semibold text-canvas-fg">Disk cleanup</h3>
            <span className="text-[11px] text-canvas-muted">
              Removes unused images, stopped containers, dangling networks, and the build cache.
              Volumes are not touched.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={busy}
            className="rounded-md border border-canvas-border bg-canvas-surface px-2.5 py-1.5 text-[11.5px] font-medium text-canvas-fg transition-colors hover:bg-canvas-surface-hover disabled:opacity-50"
          >
            Prune now
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-[11.5px] text-canvas-fg">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy || !config}
              onChange={(e) => updateConfig({ enabled: e.target.checked })}
            />
            Auto-prune
          </label>

          <div className="flex items-center gap-2 text-[11.5px] text-canvas-muted">
            <span>Every</span>
            <select
              value={INTERVAL_PRESETS.includes(intervalDays as 1) ? intervalDays : "custom"}
              disabled={busy || !config || !enabled}
              onChange={(e) => {
                if (e.target.value === "custom") {
                  setCustomDays(String(intervalDays));
                  return;
                }
                void updateConfig({ intervalDays: Number(e.target.value) });
              }}
              className="rounded-md border border-canvas-border bg-canvas-bg px-2 py-1 text-[11.5px] text-canvas-fg outline-none focus:border-accent disabled:opacity-50"
            >
              {INTERVAL_PRESETS.map((d) => (
                <option key={d} value={d}>
                  {d} {d === 1 ? "day" : "days"}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
            {!INTERVAL_PRESETS.includes(intervalDays as 1) || customDays !== "" ? (
              <input
                type="number"
                min={1}
                max={365}
                value={customDays !== "" ? customDays : String(intervalDays)}
                disabled={busy || !config || !enabled}
                onChange={(e) => setCustomDays(e.target.value)}
                onBlur={() => {
                  const n = Number(customDays);
                  if (Number.isFinite(n) && n >= 1) {
                    void updateConfig({ intervalDays: n });
                  }
                  setCustomDays("");
                }}
                className="w-16 rounded-md border border-canvas-border bg-canvas-bg px-2 py-1 text-[11.5px] text-canvas-fg outline-none focus:border-accent disabled:opacity-50"
              />
            ) : null}
          </div>

          <div className="text-[11.5px] text-canvas-muted">
            Last run: <span className="text-canvas-fg">{lastRunLabel}</span>
            {config && config.lastRunAt ? ` · freed ${formatBytes(config.lastBytesFreed)}` : null}
          </div>
        </div>

        {config?.lastError ? (
          <p className="mt-2 text-[11px] text-[var(--mon-warning)]">
            Last error: {config.lastError}
          </p>
        ) : null}

        {flash ? (
          <p
            className={`mt-2 text-[11px] ${
              flash.ok ? "text-[var(--mon-healthy)]" : "text-[var(--mon-critical)]"
            }`}
          >
            {flash.text}
          </p>
        ) : null}
      </div>

      {confirmOpen ? (
        <ConfirmActionDialog
          title="Prune unused Docker resources"
          description="Removes unused images, stopped containers, dangling networks, and the build cache. Named volumes are not touched. Running containers and their images are kept."
          auditSubject="monitoring.docker_prune"
          confirmLabel="Prune now"
          destructive
          onConfirm={runPrune}
          onClose={() => setConfirmOpen(false)}
        />
      ) : null}
    </>
  );
}
