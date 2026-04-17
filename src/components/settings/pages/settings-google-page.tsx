"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FiCheck,
  FiAlertTriangle,
  FiExternalLink,
  FiRefreshCw,
  FiMail,
  FiCalendar,
  FiFolder,
  FiLoader,
  FiCopy,
  FiTrash2,
} from "react-icons/fi";
import { authFetch } from "@/lib/auth";
import { GoogleCustomWizard } from "./google-custom-wizard";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";
const CLAUDE_CONNECTORS_URL = "https://claude.ai/settings/connectors";

type SubStatus = "connected" | "needs-auth" | "error" | "unknown";
type ServiceId = "gmail" | "google-drive" | "google-calendar";

interface McpServerInfo {
  id: string;
  name: string;
  url: string | null;
  status: SubStatus;
}

interface SubService {
  id: ServiceId;
  name: string;
  description: string;
  icon: React.ReactNode;
}

const SUB_SERVICES: SubService[] = [
  {
    id: "gmail",
    name: "Gmail",
    description: "Search and send email",
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
    description: "Read and schedule events",
    icon: <FiCalendar size={14} className="text-green-500" />,
  },
];

interface ClaudeStatus {
  connected: boolean;
}

export function SettingsGooglePage() {
  const [servers, setServers] = useState<McpServerInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [claudeConnected, setClaudeConnected] = useState<boolean | null>(null);
  const [activeService, setActiveService] = useState<ServiceId | null>(null);

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

  const refreshClaudeStatus = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/claude-auth/status`);
      if (!res.ok) throw new Error("claude status");
      const data = (await res.json()) as ClaudeStatus;
      setClaudeConnected(!!data.connected);
    } catch {
      setClaudeConnected(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshClaudeStatus();
    // Auto-refresh when user returns to this tab (likely after authorizing at claude.ai)
    const onFocus = () => {
      void refresh();
      void refreshClaudeStatus();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh, refreshClaudeStatus]);

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

  const canConnect = claudeConnected === true;

  const onConnected = useCallback(() => {
    setActiveService(null);
    void refresh();
  }, [refresh]);

  const disconnect = useCallback(
    async (id: ServiceId) => {
      try {
        await authFetch(`${BASE}/api/mcp-auth/disconnect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
      } catch {
        /* best-effort */
      }
      void refresh();
    },
    [refresh],
  );

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
              ? "Sign in with your Google account below to enable Gmail, Drive, and Calendar for Claude."
              : `${connectedCount} of ${SUB_SERVICES.length} services connected.`}
        </p>
      </div>

      {/* Precondition: must be logged into Claude Code first */}
      {claudeConnected === false && (
        <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-4">
          <div className="mb-1 flex items-center gap-2">
            <FiAlertTriangle size={14} className="text-orange-500" />
            <span className="text-[13px] font-medium text-canvas-fg">
              Log in to Claude Code first
            </span>
          </div>
          <p className="text-[12px] text-canvas-muted">
            Connecting Google uses your Claude account — no Google Cloud project needed. Open the
            Claude Code page in settings and sign in, then come back here.
          </p>
        </div>
      )}

      {/* Simple login — in-app OAuth for hosted Anthropic connectors */}
      <div>
        <p className="mb-1 text-[13px] font-semibold text-canvas-fg">
          Sign in with your Google account
        </p>
        <p className="mb-3 text-[11px] text-canvas-muted">
          One click per service. Authorization happens between your browser and Anthropic — no
          Google Cloud Console project required.
        </p>

        <div className="divide-y divide-canvas-border overflow-hidden rounded-xl border border-canvas-border bg-canvas-surface">
          {SUB_SERVICES.map((svc) => {
            const status = statusFor(svc.id);
            const isActive = activeService === svc.id;
            return (
              <div key={svc.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-canvas-bg">
                    {svc.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-canvas-fg">{svc.name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-canvas-muted">
                      {svc.description}
                    </p>
                  </div>
                  <StatusChip status={status} loading={loading} />
                  <RowAction
                    status={status}
                    isActive={isActive}
                    canConnect={canConnect}
                    onConnect={() => setActiveService(svc.id)}
                    onDisconnect={() => void disconnect(svc.id)}
                    onCancel={() => setActiveService(null)}
                  />
                </div>

                {isActive && (
                  <div className="mt-3">
                    <McpAuthFlow
                      serviceId={svc.id}
                      serviceName={svc.name}
                      onDone={onConnected}
                      onCancel={() => setActiveService(null)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-canvas-border px-3 py-2 text-[12px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:opacity-50"
        >
          <FiRefreshCw size={11} className={loading ? "animate-spin" : ""} />
          Refresh status
        </button>
        <a
          href={CLAUDE_CONNECTORS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
        >
          <FiExternalLink size={12} />
          Advanced: manage at Claude.ai
        </a>
      </div>

      {/* Divider */}
      <div className="my-2 border-t border-canvas-border" />

      {/* Custom Google Workspace (use a different Google account) */}
      <div>
        <p className="mb-1 text-[13px] font-semibold text-canvas-fg">
          Use a different Google account
        </p>
        <p className="mb-3 text-[11px] text-canvas-muted">
          Connect a separate Google account via a local MCP server using your own Google Cloud
          Console OAuth credentials. For power users who need a second account in parallel.
        </p>
        <GoogleCustomWizard />
      </div>
    </div>
  );
}

interface RowActionProps {
  status: SubStatus;
  isActive: boolean;
  canConnect: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onCancel: () => void;
}

function RowAction({
  status,
  isActive,
  canConnect,
  onConnect,
  onDisconnect,
  onCancel,
}: RowActionProps) {
  if (isActive) {
    return (
      <button
        type="button"
        onClick={onCancel}
        className="shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
      >
        Cancel
      </button>
    );
  }
  if (status === "connected") {
    return (
      <button
        type="button"
        onClick={onDisconnect}
        title="Disconnect"
        className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-canvas-muted transition-colors hover:bg-red-500/10 hover:text-red-500"
      >
        <FiTrash2 size={11} />
        Disconnect
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onConnect}
      disabled={!canConnect}
      className="shrink-0 rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
    >
      Connect
    </button>
  );
}

interface McpAuthFlowProps {
  serviceId: ServiceId;
  serviceName: string;
  onDone: () => void;
  onCancel: () => void;
}

function McpAuthFlow({ serviceId, serviceName, onDone, onCancel }: McpAuthFlowProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [completed, setCompleted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    abortRef.current = ac;

    (async () => {
      try {
        const res = await authFetch(`${BASE}/api/mcp-auth/connect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: serviceId }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || "Failed to start connect");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() || "";

          for (const block of chunks) {
            const line = block.trim();
            if (!line.startsWith("data:")) continue;
            try {
              const evt = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
              const type = evt.type as string;
              if (type === "url") {
                setUrl(evt.url as string);
              } else if (type === "log") {
                setLogs((prev) => [...prev, evt.line as string].slice(-50));
              } else if (type === "done") {
                if (evt.success) {
                  setCompleted(true);
                  onDone();
                } else {
                  setError((evt.error as string) || "Connection failed");
                }
                return;
              }
            } catch {
              /* ignore malformed */
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message || "Connect stream error");
      }
    })();

    return () => {
      ac.abort();
      // Best-effort kill of the server-side child.
      void authFetch(`${BASE}/api/mcp-auth/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: serviceId }),
      }).catch(() => {
        /* ignore */
      });
    };
  }, [serviceId, onDone]);

  const submitCode = useCallback(async () => {
    if (!code.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await authFetch(`${BASE}/api/mcp-auth/submit-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: serviceId, code: code.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || "Failed to submit code");
      }
    } catch (err) {
      setError((err as Error).message || "Failed to submit code");
    } finally {
      setSubmitting(false);
    }
  }, [code, submitting, serviceId]);

  const copyUrl = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }, [url]);

  if (completed) {
    return (
      <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3 text-[12px] text-canvas-muted">
        <div className="flex items-center gap-2">
          <FiCheck size={12} className="text-green-500" />
          <span className="text-canvas-fg">{serviceName} connected</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-[12px] text-canvas-muted">
          <div className="mb-1 flex items-center gap-2">
            <FiAlertTriangle size={12} className="text-red-500" />
            <span className="text-canvas-fg">Connection failed</span>
          </div>
          <p>{error}</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-canvas-border px-3 py-1.5 text-[11px] font-medium text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-canvas-border bg-canvas-bg p-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
          Step 1 — Authorize with Google
        </p>
        {url ? (
          <>
            <div className="flex items-center gap-2 rounded-md bg-canvas-surface px-2.5 py-1.5">
              <code className="min-w-0 flex-1 truncate text-[11px] text-canvas-fg">{url}</code>
              <button
                type="button"
                onClick={copyUrl}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
              >
                {copied ? <FiCheck size={10} /> : <FiCopy size={10} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white hover:opacity-90"
            >
              <FiExternalLink size={11} />
              Open in browser
            </a>
          </>
        ) : (
          <div className="flex items-center gap-2 text-[12px] text-canvas-muted">
            <FiLoader size={12} className="animate-spin" />
            Waiting for authorization URL...
          </div>
        )}
      </div>

      <div className="rounded-lg border border-canvas-border bg-canvas-bg p-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
          Step 2 — Paste the code (if shown)
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitCode();
            }}
            placeholder="Paste code from browser"
            className="min-w-0 flex-1 rounded-md border border-canvas-border bg-canvas-surface px-2.5 py-1.5 text-[12px] text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={submitCode}
            disabled={!code.trim() || submitting}
            className="rounded-md bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {submitting ? "..." : "Submit"}
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-canvas-muted">
          Some connectors complete without a code — just wait after authorizing.
        </p>
      </div>

      {logs.length > 0 && (
        <details className="rounded-lg border border-canvas-border bg-canvas-bg p-2 text-[11px] text-canvas-muted">
          <summary className="cursor-pointer select-none px-1 py-0.5">Show log</summary>
          <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap px-1 font-mono text-[10px] leading-relaxed">
            {logs.join("\n")}
          </pre>
        </details>
      )}
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
