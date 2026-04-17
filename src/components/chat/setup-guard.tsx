"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FiAlertTriangle, FiDownload, FiTerminal, FiCheck, FiX } from "react-icons/fi";
import { authFetch } from "@/lib/auth";

type Status = "checking" | "ready" | "missing" | "installing" | "installed" | "failed";

interface SetupGuardProps {
  children: ReactNode;
}

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

/**
 * Wraps the chat input area. Checks if Claude Code CLI is available via
 * the health endpoint. If not, shows an install UI instead of the children.
 */
export function SetupGuard({ children }: SetupGuardProps) {
  const [status, setStatus] = useState<Status>("checking");
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const logEndRef = useRef<HTMLDivElement>(null);

  const checkHealth = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/health`);
      if (!res.ok) {
        setStatus("missing");
        return;
      }
      const data = await res.json();
      if (data.claude?.available) {
        setStatus("ready");
      } else {
        setErrorMsg(data.claude?.error || "Claude Code CLI is not installed");
        setStatus("missing");
      }
    } catch {
      setStatus("missing");
      setErrorMsg("Could not reach the server");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    authFetch(`${BASE}/api/health`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.claude?.available) {
          setStatus("ready");
        } else {
          setErrorMsg(data?.claude?.error || "Claude Code CLI is not installed");
          setStatus("missing");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("missing");
          setErrorMsg("Could not reach the server");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleInstall = useCallback(async () => {
    setStatus("installing");
    setLogs([]);

    try {
      const res = await authFetch(`${BASE}/api/setup/install`, { method: "POST" });
      if (!res.ok || !res.body) {
        setStatus("failed");
        setErrorMsg("Failed to start installation");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const text = JSON.parse(line.slice(6));
              setLogs((prev) => [...prev, text]);
            } catch {
              /* ignore malformed */
            }
          }
          if (line.startsWith("event: done")) {
            // Next data line has the result
          }
        }
      }

      // Re-check health after install
      const healthRes = await authFetch(`${BASE}/api/health`);
      const healthData = await healthRes.json();
      if (healthData.claude?.available) {
        setStatus("installed");
        // Transition to ready after a brief success message
        setTimeout(() => setStatus("ready"), 2000);
      } else {
        setStatus("failed");
        setErrorMsg("Installation completed but Claude Code is still not detected");
      }
    } catch (err) {
      setStatus("failed");
      setErrorMsg(err instanceof Error ? err.message : "Installation failed");
    }
  }, []);

  // Ready — show normal chat input
  if (status === "ready") {
    return <>{children}</>;
  }

  // Checking — show nothing (brief flash)
  if (status === "checking") {
    return (
      <div className="shrink-0 px-3 py-4">
        <div className="flex items-center justify-center gap-2 text-canvas-muted">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-canvas-border border-t-canvas-muted" />
          <span className="text-[12px]">Checking Claude Code...</span>
        </div>
      </div>
    );
  }

  // Installing — show log overlay
  if (status === "installing") {
    return (
      <div className="shrink-0 border-t border-canvas-border">
        <div className="px-4 py-3">
          <div className="mb-2 flex items-center gap-2">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" />
            <span className="text-[13px] font-medium text-canvas-fg">
              Installing Claude Code...
            </span>
          </div>
          <div className="max-h-40 overflow-y-auto rounded-lg bg-black/30 px-3 py-2 font-mono text-[11px] leading-relaxed text-canvas-muted">
            {logs.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>
    );
  }

  // Installed — brief success
  if (status === "installed") {
    return (
      <div className="shrink-0 px-3 py-4">
        <div className="flex items-center justify-center gap-2 text-green-400">
          <FiCheck size={16} />
          <span className="text-[13px] font-medium">Claude Code installed successfully</span>
        </div>
      </div>
    );
  }

  // Failed — show error with retry
  if (status === "failed") {
    return (
      <div className="shrink-0 border-t border-canvas-border">
        <div className="px-4 py-4">
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 text-red-400">
              <FiX size={16} />
              <span className="text-[13px] font-medium">Installation failed</span>
            </div>
            {errorMsg && <p className="text-center text-[11px] text-canvas-muted">{errorMsg}</p>}
            {logs.length > 0 && (
              <div className="max-h-28 w-full overflow-y-auto rounded-lg bg-black/30 px-3 py-2 font-mono text-[11px] leading-relaxed text-canvas-muted">
                {logs.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleInstall}
                className="rounded-lg bg-purple-500 px-4 py-2 text-[12px] font-medium text-white hover:bg-purple-600 transition-colors"
              >
                Retry Install
              </button>
              <button
                type="button"
                onClick={checkHealth}
                className="rounded-lg border border-canvas-border px-4 py-2 text-[12px] font-medium text-canvas-muted hover:text-canvas-fg transition-colors"
              >
                Re-check
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Missing — show setup UI
  return (
    <div className="shrink-0 border-t border-canvas-border">
      <div className="px-4 py-5">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-500/10">
            <FiAlertTriangle size={22} className="text-orange-400" />
          </div>
          <div className="text-center">
            <p className="text-[14px] font-semibold text-canvas-fg">Setup Required</p>
            <p className="mt-1 text-[12px] text-canvas-muted">
              {errorMsg || "Claude Code CLI is not installed on this machine."}
            </p>
          </div>
          <button
            type="button"
            onClick={handleInstall}
            className="flex items-center gap-2 rounded-xl bg-purple-500 px-5 py-2.5 text-[13px] font-medium text-white hover:bg-purple-600 transition-colors active:scale-95"
          >
            <FiDownload size={14} />
            Install Claude Code
          </button>
          <div className="flex items-center gap-1.5 rounded-lg bg-canvas-surface px-3 py-2">
            <FiTerminal size={12} className="text-canvas-muted" />
            <code className="text-[11px] text-canvas-muted select-all">
              npm i -g @anthropic-ai/claude-code
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}
