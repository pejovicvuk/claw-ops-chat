"use client";

import { useEffect, useRef, useState } from "react";
import { FiSearch } from "react-icons/fi";
import type { AuditCategory, AuditFilter, AuditSeverity } from "@/lib/audit/types";

interface AuditFilterBarProps {
  filter: AuditFilter;
  onChange: (next: AuditFilter) => void;
  /** Optional auto-refresh setting (selected option). */
  autoRefreshSec?: number | null;
  onAutoRefreshChange?: (sec: number | null) => void;
}

const AUTO_REFRESH_OPTIONS: Array<{ value: number | null; label: string }> = [
  { value: null, label: "Off" },
  { value: 5, label: "5s" },
  { value: 10, label: "10s" },
  { value: 30, label: "30s" },
];

const CATEGORIES: AuditCategory[] = ["api", "cron", "session", "alert"];
const SEVERITIES: AuditSeverity[] = ["info", "warn", "error"];

type RangePreset = "1h" | "today" | "7d" | "30d" | "all";

function rangeToBounds(preset: RangePreset): { from?: number; to?: number } {
  const now = Date.now();
  switch (preset) {
    case "1h":
      return { from: now - 60 * 60 * 1000 };
    case "today": {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return { from: d.getTime() };
    }
    case "7d":
      return { from: now - 7 * 24 * 60 * 60 * 1000 };
    case "30d":
      return { from: now - 30 * 24 * 60 * 60 * 1000 };
    case "all":
      return {};
  }
}

export function AuditFilterBar({
  filter,
  onChange,
  autoRefreshSec,
  onAutoRefreshChange,
}: AuditFilterBarProps) {
  const [q, setQ] = useState(filter.q ?? "");
  const [range, setRange] = useState<RangePreset>("7d");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [showCustom, setShowCustom] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialise range-bound once on mount.
  useEffect(() => {
    const bounds = rangeToBounds("7d");
    onChange({ ...filter, ...bounds });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleCategory = (cat: AuditCategory) => {
    const current = filter.category ?? [...CATEGORIES];
    const next = current.includes(cat) ? current.filter((c) => c !== cat) : [...current, cat];
    onChange({ ...filter, category: next.length === 0 ? undefined : next });
  };

  const toggleSeverity = (sev: AuditSeverity) => {
    const current = filter.severity ?? [...SEVERITIES];
    const next = current.includes(sev) ? current.filter((c) => c !== sev) : [...current, sev];
    onChange({ ...filter, severity: next.length === 0 ? undefined : next });
  };

  const onRangeChange = (preset: RangePreset) => {
    setRange(preset);
    const bounds = rangeToBounds(preset);
    onChange({ ...filter, from: bounds.from, to: bounds.to });
  };

  const onSearchChange = (val: string) => {
    setQ(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onChange({ ...filter, q: val.trim() || undefined });
    }, 300);
  };

  const activeCategories = filter.category ?? [...CATEGORIES];
  const activeSeverities = filter.severity ?? [...SEVERITIES];

  return (
    <div className="space-y-2">
      {/* Category pills */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-canvas-muted">Category:</span>
        {CATEGORIES.map((cat) => {
          const active = activeCategories.includes(cat);
          return (
            <button
              key={cat}
              type="button"
              onClick={() => toggleCategory(cat)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                active
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-canvas-border text-canvas-muted hover:bg-canvas-surface-hover"
              }`}
            >
              {cat}
            </button>
          );
        })}

        <span className="ml-2 text-[11px] text-canvas-muted">Severity:</span>
        {SEVERITIES.map((sev) => {
          const active = activeSeverities.includes(sev);
          const color =
            sev === "error" ? "red-500" : sev === "warn" ? "yellow-500" : "canvas-muted";
          return (
            <button
              key={sev}
              type="button"
              onClick={() => toggleSeverity(sev)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                active
                  ? `border-${color} text-${color}`
                  : "border-canvas-border text-canvas-muted hover:bg-canvas-surface-hover"
              }`}
            >
              {sev}
            </button>
          );
        })}
      </div>

      {/* Range + search */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-canvas-muted">Range:</span>
        {(["1h", "today", "7d", "30d", "all"] as RangePreset[]).map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => {
              setShowCustom(false);
              onRangeChange(preset);
            }}
            className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
              range === preset && !showCustom
                ? "border-accent bg-accent/10 text-accent"
                : "border-canvas-border text-canvas-muted hover:bg-canvas-surface-hover"
            }`}
          >
            {preset === "1h" ? "Last hour" : preset === "today" ? "Today" : preset}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowCustom((p) => !p)}
          className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
            showCustom
              ? "border-accent bg-accent/10 text-accent"
              : "border-canvas-border text-canvas-muted hover:bg-canvas-surface-hover"
          }`}
        >
          Custom
        </button>
        {onAutoRefreshChange ? (
          <div className="ml-2 inline-flex items-center gap-1 rounded-md border border-canvas-border px-2 py-0.5">
            <span className="text-[10.5px] text-canvas-muted">Auto-refresh</span>
            <select
              value={
                autoRefreshSec === null || autoRefreshSec === undefined
                  ? "off"
                  : String(autoRefreshSec)
              }
              onChange={(e) => {
                const v = e.target.value;
                onAutoRefreshChange?.(v === "off" ? null : Number.parseInt(v, 10));
              }}
              className="bg-transparent text-[11px] text-canvas-fg outline-none"
            >
              {AUTO_REFRESH_OPTIONS.map((opt) => (
                <option
                  key={String(opt.value)}
                  value={opt.value === null ? "off" : String(opt.value)}
                >
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          <FiSearch size={12} className="text-canvas-muted" />
          <input
            type="text"
            value={q}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search subject / actor / route"
            className="w-56 rounded-md border border-canvas-border bg-canvas-bg px-2 py-1 text-[11px] text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      {showCustom ? (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-canvas-border bg-canvas-surface-hover/30 p-2">
          <label className="flex flex-col gap-0.5 text-[10.5px] text-canvas-muted">
            From
            <input
              type="datetime-local"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-md border border-canvas-border bg-canvas-bg px-2 py-1 text-[11px] text-canvas-fg focus:border-accent focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[10.5px] text-canvas-muted">
            To
            <input
              type="datetime-local"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-md border border-canvas-border bg-canvas-bg px-2 py-1 text-[11px] text-canvas-fg focus:border-accent focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              const fromMs = customFrom ? new Date(customFrom).getTime() : undefined;
              const toMs = customTo ? new Date(customTo).getTime() : undefined;
              onChange({
                ...filter,
                from: Number.isFinite(fromMs as number) ? fromMs : undefined,
                to: Number.isFinite(toMs as number) ? toMs : undefined,
              });
            }}
            className="rounded-md bg-accent px-3 py-1 text-[11px] font-medium text-white hover:bg-accent-hover"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => {
              setCustomFrom("");
              setCustomTo("");
              setShowCustom(false);
              onRangeChange("7d");
            }}
            className="text-[11px] text-canvas-muted hover:text-canvas-fg"
          >
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );
}
