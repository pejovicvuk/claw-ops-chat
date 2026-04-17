"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FiCheck,
  FiAlertTriangle,
  FiExternalLink,
  FiRefreshCw,
  FiMail,
  FiCalendar,
  FiFolder,
  FiLoader,
} from "react-icons/fi";
import { authFetch } from "@/lib/auth";
import { GoogleCustomWizard } from "./google-custom-wizard";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";
const CLAUDE_CONNECTORS_URL = "https://claude.ai/settings/connectors";

type SubStatus = "connected" | "needs-auth" | "error" | "unknown";

interface McpServerInfo {
  id: string;
  name: string;
  url: string | null;
  status: SubStatus;
}

interface SubService {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
}

const SUB_SERVICES: SubService[] = [
  {
    id: "gmail",
    name: "Gmail",
    description: "Search and analyze your email",
    icon: <FiMail size={14} className="text-red-500" />,
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Access files and documents",
    icon: <FiFolder size={14} className="text-blue-500" />,
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "Read your schedule and events",
    icon: <FiCalendar size={14} className="text-green-500" />,
  },
];

export function SettingsGooglePage() {
  const [servers, setServers] = useState<McpServerInfo[] | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${BASE}/api/mcp-status`);
      if (!res.ok) throw new Error("fetch failed");
      const data = (await res.json()) as { servers: McpServerInfo[] };
      setServers(data.servers || []);
    } catch {
      setServers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Auto-refresh when user returns to this tab (likely after authorizing at claude.ai)
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  // Derive per-sub-service status from the server list
  function statusFor(id: string): SubStatus {
    if (!servers) return "unknown";
    return servers.find((s) => s.id === id)?.status ?? "needs-auth";
  }

  // Aggregate: connected count
  const statuses = SUB_SERVICES.map((s) => statusFor(s.id));
  const connectedCount = statuses.filter((s) => s === "connected").length;
  const allConnected = connectedCount === SUB_SERVICES.length;
  const noneConfigured = !servers || servers.length === 0;

  return (
    <div className="space-y-4">
      {/* Overall status banner */}
      <div
        className={`rounded-xl border p-4 ${
          allConnected
            ? "border-green-500/20 bg-green-500/5"
            : "border-orange-500/20 bg-orange-500/5"
        }`}
      >
        <div className="mb-1 flex items-center gap-2">
          {allConnected ? (
            <FiCheck size={14} className="text-green-500" />
          ) : (
            <FiAlertTriangle size={14} className="text-orange-500" />
          )}
          <span className="text-[13px] font-medium text-canvas-fg">
            {allConnected ? "All connected" : "Needs setup"}
          </span>
        </div>
        <p className="text-[12px] text-canvas-muted">
          {loading
            ? "Checking status..."
            : noneConfigured
              ? "Google Workspace connectors aren't set up yet. Use the button below to configure them at Claude.ai."
              : `${connectedCount} of ${SUB_SERVICES.length} services connected.`}
        </p>
      </div>

      {/* Sub-service list */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
          Sub-services
        </p>
        <div className="divide-y divide-canvas-border overflow-hidden rounded-xl border border-canvas-border bg-canvas-surface">
          {SUB_SERVICES.map((svc) => {
            const status = statusFor(svc.id);
            return (
              <div key={svc.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-canvas-bg">
                  {svc.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-canvas-fg">{svc.name}</p>
                  <p className="mt-0.5 truncate text-[11px] text-canvas-muted">{svc.description}</p>
                </div>
                <StatusChip status={status} loading={loading} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Info + actions */}
      <div className="rounded-xl bg-canvas-surface p-4">
        <p className="text-[12px] text-canvas-muted">
          Google Workspace connectors are managed at Claude.ai. Click the button below to sign in
          and authorize access. When you return to this tab, the status will refresh automatically.
        </p>
      </div>

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

      {/* Divider */}
      <div className="my-2 border-t border-canvas-border" />

      {/* Custom Google Workspace (use a different Google account) */}
      <div>
        <p className="mb-1 text-[13px] font-semibold text-canvas-fg">
          Use a different Google account
        </p>
        <p className="mb-3 text-[11px] text-canvas-muted">
          Connect a separate Google account via a local MCP server. Useful if the account tied to
          your Claude.ai subscription isn&apos;t the one you want Claude to work with.
        </p>
        <GoogleCustomWizard />
      </div>
    </div>
  );
}

function StatusChip({ status, loading }: { status: SubStatus; loading: boolean }) {
  if (loading && status === "unknown") {
    return <FiLoader size={12} className="animate-spin text-canvas-muted" />;
  }
  const map: Record<SubStatus, { label: string; className: string }> = {
    connected: { label: "Connected", className: "bg-green-500/10 text-green-500" },
    "needs-auth": { label: "Needs auth", className: "bg-orange-500/10 text-orange-500" },
    error: { label: "Error", className: "bg-red-500/10 text-red-500" },
    unknown: { label: "—", className: "bg-canvas-bg text-canvas-muted" },
  };
  const s = map[status];
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${s.className}`}>
      {s.label}
    </span>
  );
}
