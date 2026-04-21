"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FiCheck,
  FiAlertTriangle,
  FiExternalLink,
  FiRefreshCw,
  FiMessageCircle,
  FiHash,
  FiBell,
  FiInfo,
} from "react-icons/fi";
import { authFetch } from "@/lib/auth";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";
const CLAUDE_CONNECTORS_URL = "https://claude.ai/settings/connectors";

type Status = "connected" | "needs-auth" | "error" | "unknown";

interface McpServerInfo {
  id: string;
  name: string;
  url: string | null;
  status: Status;
}

/** Capabilities bundled inside the Slack connector — informational only. */
const CAPABILITIES = [
  {
    name: "Channels",
    description: "Read messages from public and private channels",
    icon: <FiHash size={14} className="text-purple-500" />,
  },
  {
    name: "Direct messages",
    description: "Search DMs and threaded conversations",
    icon: <FiMessageCircle size={14} className="text-purple-500" />,
  },
  {
    name: "Mentions & notifications",
    description: "Surface messages that mention you",
    icon: <FiBell size={14} className="text-purple-500" />,
  },
];

export function SettingsSlackPage() {
  const [server, setServer] = useState<McpServerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notConfigured, setNotConfigured] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${BASE}/api/mcp-status`);
      if (!res.ok) throw new Error("fetch failed");
      const data = (await res.json()) as { servers: McpServerInfo[] };
      const slack = data.servers.find((s) => s.id === "slack");
      if (slack) {
        setServer(slack);
        setNotConfigured(false);
      } else {
        setServer(null);
        setNotConfigured(true);
      }
    } catch {
      setServer(null);
      setNotConfigured(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const status: Status = notConfigured ? "needs-auth" : (server?.status ?? "unknown");
  const connected = status === "connected";

  return (
    <div className="space-y-4">
      {/* Overall status banner */}
      <div
        className={`rounded-xl border p-4 ${
          connected ? "border-green-500/20 bg-green-500/5" : "border-orange-500/20 bg-orange-500/5"
        }`}
      >
        <div className="mb-1 flex items-center gap-2">
          {connected ? (
            <FiCheck size={14} className="text-green-500" />
          ) : (
            <FiAlertTriangle size={14} className="text-orange-500" />
          )}
          <span className="text-[13px] font-medium text-canvas-fg">
            {connected ? "Connected" : notConfigured ? "Not configured" : "Needs authentication"}
          </span>
        </div>
        <p className="text-[12px] text-canvas-muted">
          {loading
            ? "Checking status..."
            : connected
              ? "Slack is connected and ready to use."
              : notConfigured
                ? "Slack connector isn't set up yet. Add it at Claude.ai using the button below."
                : "Sign in at Claude.ai to authorize access to your workspace."}
        </p>
      </div>

      {/* Workspace-account notice */}
      <div className="flex items-start gap-2 rounded-xl border border-canvas-border bg-canvas-surface p-3">
        <FiInfo size={14} className="mt-0.5 shrink-0 text-canvas-muted" />
        <p className="text-[11px] leading-relaxed text-canvas-muted">
          Connects to the Slack workspace you authorize at Claude.ai. Claude sees only the channels
          and DMs your Slack account has access to. Read-only — Claude can search and summarize but
          cannot post messages.
        </p>
      </div>

      {/* Capabilities list */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
          What&apos;s included
        </p>
        <div className="divide-y divide-canvas-border overflow-hidden rounded-xl border border-canvas-border bg-canvas-surface">
          {CAPABILITIES.map((cap) => (
            <div key={cap.name} className="flex items-center gap-3 px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-canvas-bg">
                {cap.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-canvas-fg">{cap.name}</p>
                <p className="mt-0.5 truncate text-[11px] text-canvas-muted">{cap.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={CLAUDE_CONNECTORS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white transition-colors hover:opacity-90"
        >
          <FiExternalLink size={12} />
          Manage at Claude.ai
        </a>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-canvas-border px-3 py-2 text-[12px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:opacity-50"
        >
          <FiRefreshCw size={11} className={loading ? "animate-spin" : ""} />
          Refresh status
        </button>
      </div>
    </div>
  );
}
