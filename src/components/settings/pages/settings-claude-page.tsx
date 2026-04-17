"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FiAlertTriangle,
  FiCheck,
  FiCopy,
  FiExternalLink,
  FiKey,
  FiLoader,
  FiLogOut,
  FiStar,
  FiTerminal,
  FiZap,
} from "react-icons/fi";
import { authFetch } from "@/lib/auth";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

type LoginMethod = "claudeai" | "console" | "token";
type UiState = "loading" | "connected" | "disconnected" | "logging-in" | "error";

interface Status {
  connected: boolean;
  email: string | null;
  subscriptionType: string | null;
  expiresAt: number | null;
}

/**
 * Claude Code connection detail page — login/logout/status UI that drives
 * the `claude auth login` interactive flow via SSE + POST /submit-code.
 */
export function SettingsClaudePage() {
  const [ui, setUi] = useState<UiState>("loading");
  const [status, setStatus] = useState<Status | null>(null);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  /** Fetch current auth status and reflect into UI. */
  const refreshStatus = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/claude-auth/status`);
      if (!res.ok) throw new Error("status");
      const data = (await res.json()) as Status;
      setStatus(data);
      setUi(data.connected ? "connected" : "disconnected");
    } catch {
      setStatus(null);
      setUi("disconnected");
    }
  }, []);

  // Initial load — fetch status.
  useEffect(() => {
    void refreshStatus();
    return () => {
      // Abort any live SSE stream on unmount.
      abortRef.current?.abort();
    };
  }, [refreshStatus]);

  const startLogin = useCallback(
    async (method: LoginMethod) => {
      setUi("logging-in");
      setLoginUrl(null);
      setCode("");
      setErrorMsg(null);
      setLogs([]);

      // Cancel any previous stream.
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const res = await authFetch(`${BASE}/api/claude-auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error("Failed to start login");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const block of lines) {
            const line = block.trim();
            if (!line.startsWith("data:")) continue;
            try {
              const evt = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
              const type = evt.type as string;
              if (type === "url") {
                setLoginUrl(evt.url as string);
              } else if (type === "log") {
                setLogs((prev) => [...prev, evt.line as string].slice(-50));
              } else if (type === "done") {
                if (evt.success) {
                  // Credentials saved — refresh status.
                  await refreshStatus();
                  return;
                } else {
                  setErrorMsg((evt.error as string) || "Login failed");
                  setUi("error");
                  return;
                }
              }
            } catch {
              /* malformed event, ignore */
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setErrorMsg((err as Error).message || "Login stream error");
        setUi("error");
      }
    },
    [refreshStatus],
  );

  const submitCode = useCallback(async () => {
    if (!code.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await authFetch(`${BASE}/api/claude-auth/submit-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMsg(body.error || "Failed to submit code");
        setUi("error");
      }
      // On success, the SSE stream will emit `done` and refresh status.
    } catch (err) {
      setErrorMsg((err as Error).message || "Failed to submit code");
      setUi("error");
    } finally {
      setSubmitting(false);
    }
  }, [code, submitting]);

  const cancelLogin = useCallback(async () => {
    abortRef.current?.abort();
    try {
      await authFetch(`${BASE}/api/claude-auth/cancel`, { method: "POST" });
    } catch {
      /* best-effort */
    }
    setLoginUrl(null);
    setCode("");
    setLogs([]);
    setUi("disconnected");
  }, []);

  const logout = useCallback(async () => {
    try {
      await authFetch(`${BASE}/api/claude-auth/logout`, { method: "POST" });
    } catch {
      /* best-effort */
    }
    await refreshStatus();
  }, [refreshStatus]);

  const copyUrl = useCallback(async () => {
    if (!loginUrl) return;
    try {
      await navigator.clipboard.writeText(loginUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }, [loginUrl]);

  // ───────────── Rendering ─────────────

  if (ui === "loading") {
    return (
      <div className="flex items-center justify-center py-12 text-canvas-muted">
        <FiLoader size={16} className="animate-spin" />
      </div>
    );
  }

  if (ui === "connected" && status) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <FiCheck size={14} className="text-green-500" />
            <span className="text-[13px] font-medium text-canvas-fg">Connected</span>
          </div>
          <div className="space-y-1 text-[12px] text-canvas-muted">
            {status.subscriptionType && (
              <p>
                Plan: <span className="text-canvas-fg">{status.subscriptionType}</span>
              </p>
            )}
            {status.email && (
              <p>
                Account: <span className="text-canvas-fg">{status.email}</span>
              </p>
            )}
            {status.expiresAt && (
              <p>
                Expires: <span className="text-canvas-fg">{formatExpiry(status.expiresAt)}</span>
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={logout}
          className="flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] font-medium text-red-500 transition-colors hover:bg-red-500/15"
        >
          <FiLogOut size={13} />
          Log out of Claude Code
        </button>
      </div>
    );
  }

  if (ui === "logging-in") {
    return (
      <div className="space-y-4">
        {/* Step 1: URL */}
        <div className="rounded-xl border border-canvas-border bg-canvas-surface p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
            Step 1 of 2 — Open the login page
          </p>
          {loginUrl ? (
            <>
              <div className="flex items-center gap-2 rounded-lg bg-canvas-bg px-3 py-2">
                <code className="min-w-0 flex-1 truncate text-[11px] text-canvas-fg">
                  {loginUrl}
                </code>
                <button
                  type="button"
                  onClick={copyUrl}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
                >
                  {copied ? <FiCheck size={11} /> : <FiCopy size={11} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <a
                href={loginUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white transition-colors hover:opacity-90"
              >
                <FiExternalLink size={12} />
                Open in browser
              </a>
            </>
          ) : (
            <div className="flex items-center gap-2 text-[12px] text-canvas-muted">
              <FiLoader size={12} className="animate-spin" />
              Waiting for login URL...
            </div>
          )}
        </div>

        {/* Step 2: Code */}
        <div className="rounded-xl border border-canvas-border bg-canvas-surface p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
            Step 2 of 2 — Paste your code
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitCode();
              }}
              placeholder="xxx-xxx-xxx"
              className="min-w-0 flex-1 rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 text-[12px] text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={submitCode}
              disabled={!code.trim() || submitting}
              className="rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-40"
            >
              {submitting ? "..." : "Submit"}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-canvas-muted">
            After authorizing, copy the code shown in your browser.
          </p>
        </div>

        {/* Live log (collapsed) */}
        {logs.length > 0 && (
          <details className="rounded-xl border border-canvas-border bg-canvas-bg p-2 text-[11px] text-canvas-muted">
            <summary className="cursor-pointer select-none px-1 py-1">Show log</summary>
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap px-1 font-mono text-[10px] leading-relaxed">
              {logs.join("\n")}
            </pre>
          </details>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={cancelLogin}
            className="rounded-lg px-3 py-2 text-[12px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (ui === "error") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
          <div className="mb-1 flex items-center gap-2">
            <FiAlertTriangle size={14} className="text-red-500" />
            <span className="text-[13px] font-medium text-canvas-fg">Login failed</span>
          </div>
          <p className="text-[12px] text-canvas-muted">{errorMsg || "Unknown error"}</p>
        </div>
        <button
          type="button"
          onClick={() => setUi("disconnected")}
          className="rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white hover:opacity-90"
        >
          Try again
        </button>
      </div>
    );
  }

  // ui === "disconnected" — show method cards
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4">
        <div className="mb-1 flex items-center gap-2">
          <FiAlertTriangle size={14} className="text-orange-500" />
          <span className="text-[13px] font-medium text-canvas-fg">Not connected</span>
        </div>
        <p className="text-[12px] text-canvas-muted">
          Sign in to use Claude Code from this app. Claude Code runs locally on your machine.
        </p>
      </div>

      <p className="text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
        Choose a login method
      </p>

      <MethodCard
        icon={<FiStar size={16} className="text-accent" />}
        title="Claude subscription"
        description="Use your Pro or Max plan. Recommended for most users."
        badge="Recommended"
        onClick={() => startLogin("claudeai")}
      />

      <MethodCard
        icon={<FiKey size={16} />}
        title="Anthropic Console"
        description="Pay per API use with an Anthropic Console account."
        onClick={() => startLogin("console")}
      />

      <MethodCard
        icon={<FiZap size={16} />}
        title="Long-lived token"
        description="For CI/scripts. Requires a Claude subscription."
        onClick={() => startLogin("token")}
      />

      <div className="flex items-center gap-2 rounded-lg bg-canvas-surface px-3 py-2">
        <FiTerminal size={12} className="text-canvas-muted" />
        <code className="select-all text-[11px] text-canvas-muted">claude auth login</code>
        <span className="text-[10px] text-canvas-muted">— runs the same flow in your terminal</span>
      </div>
    </div>
  );
}

interface MethodCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
  onClick: () => void;
}

function MethodCard({ icon, title, description, badge, onClick }: MethodCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-canvas-border bg-canvas-surface px-4 py-3 text-left transition-colors hover:bg-canvas-surface-hover"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-canvas-bg text-canvas-fg">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[13px] font-medium text-canvas-fg">{title}</p>
          {badge && (
            <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent">
              {badge}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[11px] text-canvas-muted">{description}</p>
      </div>
    </button>
  );
}

function formatExpiry(ts: number): string {
  const diff = ts - Date.now();
  if (diff <= 0) return "expired";
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days > 1) return `in ${days} days`;
  const hours = Math.floor(diff / (60 * 60 * 1000));
  if (hours > 1) return `in ${hours} hours`;
  const mins = Math.floor(diff / (60 * 1000));
  return `in ${mins} minutes`;
}
