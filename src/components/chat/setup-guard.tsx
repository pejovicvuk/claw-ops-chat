"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FiAlertTriangle, FiDownload, FiTerminal, FiCheck, FiX } from "react-icons/fi";
import { authFetch } from "@/lib/auth";

type Status = "ready" | "missing" | "installing" | "installed" | "failed";

interface SetupGuardProps {
  children: ReactNode;
  /** When true, show the install UI (triggered by runtime SDK errors via WebSocket). */
  forceShow?: boolean;
}

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

/**
 * Wraps the chat input area. Shows normal children by default.
 * When `forceShow` flips to true (SDK threw executable-not-found at runtime),
 * replaces children with the install UI.
 */
export function SetupGuard({ children, forceShow }: SetupGuardProps) {
  const [status, setStatus] = useState<Status>("ready");
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const logEndRef = useRef<HTMLDivElement>(null);

  // When the SDK reports an executable error at runtime, show install UI.
  if (forceShow && status === "ready") {
    setErrorMsg("Claude Code CLI could not be started. The SDK binary may need reinstalling.");
    setStatus("missing");
  }

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
              const parsed = JSON.parse(line.slice(6));
              if (typeof parsed === "string") {
                setLogs((prev) => [...prev, parsed]);
              }
            } catch {
              /* ignore malformed */
            }
          }
        }
      }

      // After install, tell user to restart
      setStatus("installed");
      setLogs((prev) => [
        ...prev,
        "Please restart the dev server (npm run dev) for changes to take effect.",
      ]);
    } catch (err) {
      setStatus("failed");
      setErrorMsg(err instanceof Error ? err.message : "Installation failed");
    }
  }, []);

  // Ready — show normal chat input
  if (status === "ready") {
    return <>{children}</>;
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

  // Installed — success with restart instruction
  if (status === "installed") {
    return (
      <div className="shrink-0 border-t border-canvas-border">
        <div className="px-4 py-4">
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 text-green-400">
              <FiCheck size={16} />
              <span className="text-[13px] font-medium">Installation complete</span>
            </div>
            <p className="text-center text-[12px] text-canvas-muted">
              Restart the dev server (<code className="text-[11px]">npm run dev</code>) for changes
              to take effect.
            </p>
            {logs.length > 0 && (
              <div className="max-h-28 w-full overflow-y-auto rounded-lg bg-black/30 px-3 py-2 font-mono text-[11px] leading-relaxed text-canvas-muted">
                {logs.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            )}
          </div>
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
            <button
              type="button"
              onClick={handleInstall}
              className="rounded-lg bg-purple-500 px-4 py-2 text-[12px] font-medium text-white transition-colors hover:bg-purple-600"
            >
              Retry Install
            </button>
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
              {errorMsg || "Claude Code CLI could not be started."}
            </p>
          </div>
          <button
            type="button"
            onClick={handleInstall}
            className="flex items-center gap-2 rounded-xl bg-purple-500 px-5 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-purple-600 active:scale-95"
          >
            <FiDownload size={14} />
            Install Claude Code
          </button>
          <div className="flex items-center gap-1.5 rounded-lg bg-canvas-surface px-3 py-2">
            <FiTerminal size={12} className="text-canvas-muted" />
            <code className="select-all text-[11px] text-canvas-muted">
              npm i -g @anthropic-ai/claude-code
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}
