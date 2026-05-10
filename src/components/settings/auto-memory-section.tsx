"use client";

import { useCallback, useEffect, useState } from "react";
import { FiCheck, FiCpu, FiLoader, FiRefreshCw } from "react-icons/fi";

import { authFetch } from "@/lib/auth";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

interface AutoMemoryConfig {
  enabled: boolean;
  idleMs: number;
  lastConsolidatedAt: number | null;
}

interface AutoMemoryFile {
  path: string;
  content: string;
  size: number;
  updatedAt: number;
}

function formatRelative(ms: number | null): string {
  if (ms === null) return "never";
  const diff = Date.now() - ms;
  if (diff < 0) return "in the future";
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return `${Math.floor(diff / 86_400_000)} d ago`;
}

/** Render the body of auto.md as a list of facts (one per line). */
function parseFacts(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/**
 * Settings → Memory → "Auto-collected" sub-section. Shows the consolidator's
 * current state (on/off, last run time), a "Regenerate now" button, and a
 * read-only preview of the facts in `/root/.memory/global/auto.md`. The
 * user can override individual facts via the Global memory editor below
 * (auto.md shows up there like any other curated file).
 */
export function AutoMemorySection() {
  const [config, setConfig] = useState<AutoMemoryConfig | null>(null);
  const [autoFile, setAutoFile] = useState<AutoMemoryFile | null | "missing">(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flashSavedToggle, setFlashSavedToggle] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [cfgRes, fileRes] = await Promise.all([
        authFetch(`${BASE}/api/memory/auto-config`),
        authFetch(`${BASE}/api/memory/global/auto.md`),
      ]);
      if (cfgRes.ok) {
        const data = (await cfgRes.json()) as { config: AutoMemoryConfig };
        setConfig(data.config);
      }
      if (fileRes.ok) {
        const data = (await fileRes.json()) as AutoMemoryFile;
        setAutoFile(data);
      } else if (fileRes.status === 404) {
        setAutoFile("missing");
      } else {
        setAutoFile("missing");
      }
    } catch {
      setAutoFile("missing");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = useCallback(
    async (next: boolean) => {
      if (busy) return;
      setBusy(true);
      setErr(null);
      try {
        const res = await authFetch(`${BASE}/api/memory/auto-config`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: next }),
        });
        if (!res.ok) throw new Error(`Toggle failed (${res.status})`);
        const data = (await res.json()) as { config: AutoMemoryConfig };
        setConfig(data.config);
        setFlashSavedToggle(true);
        setTimeout(() => setFlashSavedToggle(false), 1500);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to update toggle");
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const regenerate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await authFetch(`${BASE}/api/memory/auto/regenerate`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Regenerate failed (${res.status})`);
      }
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to regenerate");
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  if (config === null) {
    return (
      <div className="flex items-center justify-center py-6 text-canvas-muted">
        <FiLoader size={14} className="animate-spin" />
      </div>
    );
  }

  const facts = autoFile && autoFile !== "missing" ? parseFacts(autoFile.content) : [];

  return (
    <div className="space-y-3">
      {/* Toggle */}
      <label className="flex items-start gap-3 rounded-xl border border-canvas-border bg-canvas-bg p-3">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => void toggle(e.target.checked)}
          disabled={busy}
          className="mt-0.5 h-4 w-4 accent-accent"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-canvas-fg">
            Automatically learn from conversations
          </p>
          <p className="mt-0.5 text-[11px] text-canvas-muted">
            After each chat goes idle, a small Haiku pass extracts stable facts about you and stores
            them in <code>auto.md</code> below. Off by default in restricted deploys (
            <code>AUTO_GLOBAL_MEMORY=0</code>).
          </p>
        </div>
        {flashSavedToggle && <FiCheck size={12} className="mt-0.5 shrink-0 text-green-500" />}
      </label>

      {/* Status row */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-canvas-muted">
        <span className="inline-flex items-center gap-1">
          <FiCpu size={11} />
          Last collected: {formatRelative(config.lastConsolidatedAt)}
        </span>
        <span>·</span>
        <span>{facts.length === 1 ? "1 fact" : `${facts.length} facts`}</span>
        {autoFile && autoFile !== "missing" && (
          <>
            <span>·</span>
            <span>{autoFile.size} B</span>
          </>
        )}
      </div>

      {/* Facts preview */}
      {facts.length === 0 ? (
        <div className="rounded-xl border border-canvas-border bg-canvas-bg p-4 text-center">
          <p className="text-[12px] text-canvas-muted">
            No auto-collected facts yet. Chat normally — Claude will populate this after a session
            goes idle. Or click <strong>Regenerate now</strong> to run the consolidator against your
            most recent transcript.
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5 rounded-xl border border-canvas-border bg-canvas-bg p-3">
          {facts.map((fact, i) => (
            <li
              key={`${i}-${fact.slice(0, 32)}`}
              className="flex items-start gap-2 text-[12px] leading-relaxed text-canvas-fg"
            >
              <span className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-canvas-muted" />
              <span>{fact}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void regenerate()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 text-[12px] font-medium text-canvas-fg transition-colors hover:bg-canvas-surface-hover disabled:opacity-40"
        >
          {busy ? (
            <>
              <FiLoader size={11} className="animate-spin" />
              Working…
            </>
          ) : (
            <>
              <FiRefreshCw size={11} />
              Regenerate now
            </>
          )}
        </button>
        <span className="text-[10px] text-canvas-muted">
          Edits are also picked up by the Global memory list below.
        </span>
      </div>

      {err && <p className="text-[11px] text-red-500">{err}</p>}
    </div>
  );
}
