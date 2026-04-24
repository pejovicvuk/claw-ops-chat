"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { FiBookOpen, FiChevronRight, FiCommand, FiMessageSquare, FiUsers } from "react-icons/fi";
import { authFetch } from "@/lib/auth";
import { useUrlState } from "@/lib/use-url-state";
import { SettingsSection } from "../settings-section";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

interface Counts {
  systemPrompt: boolean;
  rules: number | null;
  subagents: number | null;
  skills: number | null;
}

/**
 * "Agent behavior" hub. Four link-cards — one per configurable surface —
 * each showing a short description and the current count so the user
 * can see at a glance what's already configured.
 */
export function SettingsAgentPage() {
  const [counts, setCounts] = useState<Counts>({
    systemPrompt: false,
    rules: null,
    subagents: null,
    skills: null,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const calls = await Promise.allSettled([
        authFetch(`${BASE}/api/agent-config/system-prompt`),
        authFetch(`${BASE}/api/agent-config/rules`),
        authFetch(`${BASE}/api/agent-config/subagents`),
        authFetch(`${BASE}/api/agent-config/skills`),
      ]);
      const next: Counts = {
        systemPrompt: false,
        rules: null,
        subagents: null,
        skills: null,
      };
      if (calls[0].status === "fulfilled" && calls[0].value.ok) {
        const data = (await calls[0].value.json()) as { prompt?: string };
        next.systemPrompt = Boolean(data.prompt && data.prompt.trim().length > 0);
      }
      if (calls[1].status === "fulfilled" && calls[1].value.ok) {
        const data = (await calls[1].value.json()) as { items?: unknown[] };
        next.rules = Array.isArray(data.items) ? data.items.length : 0;
      }
      if (calls[2].status === "fulfilled" && calls[2].value.ok) {
        const data = (await calls[2].value.json()) as { items?: unknown[] };
        next.subagents = Array.isArray(data.items) ? data.items.length : 0;
      }
      if (calls[3].status === "fulfilled" && calls[3].value.ok) {
        const data = (await calls[3].value.json()) as { items?: unknown[] };
        next.skills = Array.isArray(data.items) ? data.items.length : 0;
      }
      if (!cancelled) setCounts(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <SettingsSection
        title="Agent"
        description="Configure how Claude behaves in every session on this device"
      >
        <div className="space-y-2">
          <HubRow
            icon={<FiMessageSquare size={15} />}
            title="System prompt"
            subtitle={counts.systemPrompt ? "Custom instructions active" : "No custom prompt"}
            target="agent/system-prompt"
          />
          <HubRow
            icon={<FiBookOpen size={15} />}
            title="Rules"
            subtitle={formatCount(counts.rules, "rule", "rules")}
            target="agent/rules"
          />
          <HubRow
            icon={<FiCommand size={15} />}
            title="Skills"
            subtitle={formatCount(counts.skills, "skill", "skills")}
            target="agent/skills"
          />
          <HubRow
            icon={<FiUsers size={15} />}
            title="Subagents"
            subtitle={formatCount(counts.subagents, "subagent", "subagents")}
            target="agent/subagents"
          />
        </div>
      </SettingsSection>

      <p className="px-1 text-[10px] leading-relaxed text-canvas-muted">
        Rules and the system prompt are appended to Claude&apos;s built-in system prompt on every
        turn. Skills and subagents live under{" "}
        <code className="rounded bg-canvas-surface px-1 py-0.5">.claude/</code> and are loaded
        natively by the Claude Agent SDK.
      </p>
    </div>
  );
}

function formatCount(count: number | null, singular: string, plural: string): string {
  if (count === null) return "Loading…";
  if (count === 0) return `No ${plural} yet`;
  if (count === 1) return `1 ${singular}`;
  return `${count} ${plural}`;
}

interface HubRowProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  target: string;
}

function HubRow({ icon, title, subtitle, target }: HubRowProps) {
  const { setParam } = useUrlState();
  return (
    <button
      type="button"
      onClick={() => setParam("settings", target)}
      className="flex w-full items-center gap-3 rounded-xl border border-canvas-border bg-canvas-bg px-4 py-3 text-left transition-colors hover:bg-canvas-surface-hover"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-canvas-surface text-canvas-fg">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-canvas-fg">{title}</p>
        <p className="mt-0.5 text-[11px] text-canvas-muted">{subtitle}</p>
      </div>
      <FiChevronRight size={14} className="shrink-0 text-canvas-muted" />
    </button>
  );
}
