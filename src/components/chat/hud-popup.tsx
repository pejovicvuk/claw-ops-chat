"use client";

import { useEffect, useMemo, useState } from "react";
import type { ActiveToolInfo, ChatMessage, ClaudeStatus } from "@/lib/types";
import type { ContextUsage } from "@/lib/use-claude-chat";
import { computeCost, formatCost, ratesFor } from "@/lib/model-pricing";

interface HudPopupProps {
  status: ClaudeStatus;
  activeTool: ActiveToolInfo | null;
  contextUsage: ContextUsage | null;
  messages: ChatMessage[];
  sessionStartedAt: number | null;
}

/**
 * Session stats popup. Three sections — Session, Usage, Right now —
 * each showing a few label / value rows. Elapsed ticks every second
 * while the popup is open (we avoid a global interval so closed popups
 * don't burn render cycles).
 */
export function HudPopup({
  status,
  activeTool,
  contextUsage,
  messages,
  sessionStartedAt,
}: HudPopupProps) {
  // Tick for elapsed display. Only runs while the popup is mounted, which
  // matches how often it's visible — the parent unmounts us when closed.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const { turns, toolCalls } = useMemo(() => {
    let turns = 0;
    let toolCalls = 0;
    for (const m of messages) {
      if (m.role === "assistant" && m.type === "text") turns++;
      if (m.type === "tool_use") toolCalls++;
    }
    return { turns, toolCalls };
  }, [messages]);

  const modelLabel = useMemo(() => {
    const rates = ratesFor(contextUsage?.model);
    if (rates) return rates.label;
    if (contextUsage?.model) return contextUsage.model;
    return "—";
  }, [contextUsage]);

  const cost = useMemo(
    () =>
      contextUsage
        ? computeCost({
            model: contextUsage.model,
            inputTokens: contextUsage.inputTokens ?? 0,
            outputTokens: contextUsage.outputTokens ?? 0,
            cacheReadTokens: contextUsage.cacheReadTokens ?? 0,
            cacheCreateTokens: contextUsage.cacheCreateTokens ?? 0,
          })
        : null,
    [contextUsage],
  );

  const elapsed = sessionStartedAt ? formatElapsed(now - sessionStartedAt) : "—";
  const contextLabel = contextUsage
    ? `${contextUsage.percentage}%  (${formatTokens(contextUsage.used)} / ${formatTokens(contextUsage.max)})`
    : "—";
  const statusLabel = STATUS_LABELS[status] ?? status;
  const activeLabel =
    status === "tool_running" && activeTool ? activeTool.name : status === "idle" ? "Idle" : "—";

  return (
    <div className="animate-modal-in absolute right-0 top-full z-50 mt-1.5 min-w-[240px] rounded-xl border border-canvas-border bg-canvas-bg p-3 shadow-xl">
      <Section title="Session">
        <Row label="Model" value={modelLabel} mono />
        <Row label="Elapsed" value={elapsed} />
        <Row label="Turns" value={String(turns)} />
      </Section>
      <Divider />
      <Section title="Usage">
        <Row label="Context" value={contextLabel} />
        <Row label="Tool calls" value={String(toolCalls)} />
        <Row label="Cost" value={formatCost(cost)} />
      </Section>
      <Divider />
      <Section title="Right now">
        <Row label="Status" value={statusLabel} />
        <Row
          label="Active"
          value={activeLabel}
          mono={activeLabel !== "—" && activeLabel !== "Idle"}
        />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-canvas-muted">
        {title}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-canvas-muted">{label}</span>
      <span className={`truncate text-[12px] text-canvas-fg ${mono ? "font-mono" : "font-medium"}`}>
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="my-2 h-px bg-canvas-border/60" />;
}

const STATUS_LABELS: Record<string, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  idle: "Ready",
  thinking: "Thinking",
  tool_running: "Running tool",
  awaiting_permission: "Needs approval",
  awaiting_input: "Needs your input",
};

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatElapsed(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
