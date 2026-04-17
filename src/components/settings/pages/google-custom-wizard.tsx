"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FiAlertTriangle,
  FiCheck,
  FiCopy,
  FiExternalLink,
  FiKey,
  FiLoader,
  FiLogOut,
  FiRefreshCw,
  FiTerminal,
} from "react-icons/fi";
import { authFetch } from "@/lib/auth";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

interface Status {
  uvxInstalled: boolean;
  credentialsConfigured: boolean;
  connected: boolean;
}

type UiMode = "loading" | "setup" | "authorizing" | "connected" | "error";

/**
 * "Use a different Google account" wizard.
 * Renders below the hosted claude.ai connectors on the Google Workspace page.
 */
export function GoogleCustomWizard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<UiMode>("loading");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showInstructions, setShowInstructions] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);
  const [credentialsError, setCredentialsError] = useState<string | null>(null);

  // Auth stream state
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [authorizedEmail, setAuthorizedEmail] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);
  const [urlCopied, setUrlCopied] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/google-custom/status`);
      if (!res.ok) throw new Error("status");
      const data = (await res.json()) as Status;
      setStatus(data);
      if (data.connected) setMode("connected");
      else setMode("setup");
    } catch {
      setStatus({ uvxInstalled: false, credentialsConfigured: false, connected: false });
      setMode("setup");
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const saveCredentials = useCallback(async () => {
    if (!clientId.trim() || !clientSecret.trim() || savingCreds) return;
    setSavingCreds(true);
    setCredentialsError(null);
    try {
      const res = await authFetch(`${BASE}/api/google-custom/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Failed to save credentials");
      }
      // Clear the secret field after save so it isn't lingering in the DOM.
      setClientSecret("");
      await refreshStatus();
    } catch (err) {
      setCredentialsError(err instanceof Error ? err.message : "Failed to save credentials");
    } finally {
      setSavingCreds(false);
    }
  }, [clientId, clientSecret, savingCreds, refreshStatus]);

  const startAuthorize = useCallback(async () => {
    setMode("authorizing");
    setAuthUrl(null);
    setAuthorizedEmail(null);
    setLogs([]);
    setAuthError(null);

    try {
      const res = await authFetch(`${BASE}/api/google-custom/authorize`, { method: "POST" });
      if (!res.ok || !res.body) {
        throw new Error("Failed to start authorization");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";
        for (const block of blocks) {
          const line = block.trim();
          if (!line.startsWith("data:")) continue;
          try {
            const evt = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
            if (evt.type === "url") setAuthUrl(evt.url as string);
            else if (evt.type === "log")
              setLogs((prev) => [...prev, evt.line as string].slice(-50));
            else if (evt.type === "done") {
              if (evt.success) {
                setAuthorizedEmail((evt.email as string) || null);
                await refreshStatus();
                return;
              }
              setAuthError((evt.error as string) || "Authorization failed");
              setMode("error");
              return;
            }
          } catch {
            /* malformed event */
          }
        }
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Authorization error");
      setMode("error");
    }
  }, [refreshStatus]);

  const disconnect = useCallback(async () => {
    try {
      await authFetch(`${BASE}/api/google-custom/disconnect`, { method: "POST" });
    } catch {
      /* best-effort */
    }
    setClientId("");
    setClientSecret("");
    setAuthUrl(null);
    setAuthorizedEmail(null);
    setLogs([]);
    await refreshStatus();
  }, [refreshStatus]);

  const copyUrl = useCallback(async () => {
    if (!authUrl) return;
    try {
      await navigator.clipboard.writeText(authUrl);
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }, [authUrl]);

  // ───────────── Rendering ─────────────

  if (mode === "loading" || !status) {
    return (
      <div className="flex items-center justify-center py-8 text-canvas-muted">
        <FiLoader size={14} className="animate-spin" />
      </div>
    );
  }

  if (mode === "connected") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
          <div className="mb-1 flex items-center gap-2">
            <FiCheck size={14} className="text-green-500" />
            <span className="text-[13px] font-medium text-canvas-fg">
              Custom Google Workspace connected
            </span>
          </div>
          <p className="text-[12px] text-canvas-muted">
            Claude Code will use this connection for Gmail, Drive, Calendar, Docs, and Sheets.
            Restart the dev server after any change for it to take effect.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={startAuthorize}
            className="inline-flex items-center gap-1.5 rounded-lg border border-canvas-border px-3 py-2 text-[12px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            <FiRefreshCw size={11} />
            Re-authorize
          </button>
          <button
            type="button"
            onClick={disconnect}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] font-medium text-red-500 transition-colors hover:bg-red-500/15"
          >
            <FiLogOut size={11} />
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  if (mode === "authorizing") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-canvas-border bg-canvas-surface p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
            Authorize your Google account
          </p>
          {authUrl ? (
            <>
              <div className="flex items-center gap-2 rounded-lg bg-canvas-bg px-3 py-2">
                <code className="min-w-0 flex-1 truncate text-[11px] text-canvas-fg">
                  {authUrl}
                </code>
                <button
                  type="button"
                  onClick={copyUrl}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
                >
                  {urlCopied ? <FiCheck size={11} /> : <FiCopy size={11} />}
                  {urlCopied ? "Copied" : "Copy"}
                </button>
              </div>
              <a
                href={authUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white transition-colors hover:opacity-90"
              >
                <FiExternalLink size={12} />
                Open in browser
              </a>
              <p className="mt-3 text-[11px] text-canvas-muted">
                Pick your desired Google account, approve the scopes, and this window will
                auto-update when authorization completes.
              </p>
            </>
          ) : (
            <div className="flex items-center gap-2 text-[12px] text-canvas-muted">
              <FiLoader size={12} className="animate-spin" />
              Waiting for login URL...
            </div>
          )}
        </div>

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
            onClick={() => {
              setMode("setup");
              setAuthUrl(null);
            }}
            className="rounded-lg px-3 py-2 text-[12px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (mode === "error") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
          <div className="mb-1 flex items-center gap-2">
            <FiAlertTriangle size={14} className="text-red-500" />
            <span className="text-[13px] font-medium text-canvas-fg">Authorization failed</span>
          </div>
          <p className="text-[12px] text-canvas-muted">{authError || "Unknown error"}</p>
        </div>
        <button
          type="button"
          onClick={() => setMode("setup")}
          className="rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white hover:opacity-90"
        >
          Try again
        </button>
      </div>
    );
  }

  // mode === "setup"
  return (
    <div className="space-y-4">
      <p className="text-[11px] text-canvas-muted">
        Connect a Google account that&apos;s separate from the one linked to your Claude.ai
        subscription. This creates a local MCP server using credentials you provide — tokens stay on
        your machine.
      </p>

      {/* Step 1: uvx check */}
      <div className="rounded-xl border border-canvas-border bg-canvas-surface p-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
          Step 1 — Prerequisites
        </p>
        {status.uvxInstalled ? (
          <div className="flex items-center gap-2 text-[12px] text-canvas-fg">
            <FiCheck size={13} className="text-green-500" />
            <code className="text-[11px]">uvx</code> is installed
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[12px] text-orange-500">
              <FiAlertTriangle size={13} />
              <code className="text-[11px]">uvx</code> is not installed
            </div>
            <p className="text-[11px] text-canvas-muted">Run one of these to install it:</p>
            <div className="flex items-center gap-2 rounded-lg bg-canvas-bg px-3 py-2">
              <FiTerminal size={11} className="text-canvas-muted" />
              <code className="select-all text-[11px] text-canvas-muted">
                powershell -c &quot;irm https://astral.sh/uv/install.ps1 | iex&quot;
              </code>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-canvas-bg px-3 py-2">
              <FiTerminal size={11} className="text-canvas-muted" />
              <code className="select-all text-[11px] text-canvas-muted">
                curl -LsSf https://astral.sh/uv/install.sh | sh
              </code>
            </div>
            <button
              type="button"
              onClick={() => void refreshStatus()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-canvas-border px-3 py-1.5 text-[11px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
            >
              <FiRefreshCw size={10} />
              Check again
            </button>
          </div>
        )}
      </div>

      {/* Step 2: Credentials */}
      <div
        className={`rounded-xl border border-canvas-border bg-canvas-surface p-4 ${
          !status.uvxInstalled ? "opacity-50" : ""
        }`}
      >
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
          Step 2 — Google OAuth credentials
        </p>

        <button
          type="button"
          onClick={() => setShowInstructions((v) => !v)}
          className="mb-3 text-[11px] text-accent hover:underline"
        >
          {showInstructions ? "Hide" : "Show"} setup instructions
        </button>

        {showInstructions && (
          <ol className="mb-3 list-decimal space-y-1.5 pl-4 text-[11px] leading-relaxed text-canvas-muted">
            <li>
              Open{" "}
              <a
                href="https://console.cloud.google.com/projectcreate"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                Google Cloud Console
              </a>{" "}
              and create (or pick) a project.
            </li>
            <li>
              Enable APIs:{" "}
              <a
                href="https://console.cloud.google.com/apis/library/gmail.googleapis.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                Gmail
              </a>
              ,{" "}
              <a
                href="https://console.cloud.google.com/apis/library/drive.googleapis.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                Drive
              </a>
              ,{" "}
              <a
                href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                Calendar
              </a>
              .
            </li>
            <li>
              Go to{" "}
              <a
                href="https://console.cloud.google.com/apis/credentials/consent"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                OAuth consent screen
              </a>{" "}
              → External → add your Google email as a test user.
            </li>
            <li>
              Go to{" "}
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                Credentials
              </a>{" "}
              → Create Credentials → OAuth client ID →{" "}
              <span className="font-medium text-canvas-fg">Desktop app</span>.
            </li>
            <li>Copy the Client ID and Client Secret into the fields below.</li>
          </ol>
        )}

        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-[11px] text-canvas-muted" htmlFor="gc-client-id">
              Client ID
            </label>
            <input
              id="gc-client-id"
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="1234567890-abc.apps.googleusercontent.com"
              disabled={!status.uvxInstalled}
              className="w-full rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 text-[12px] text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none disabled:opacity-50"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-canvas-muted" htmlFor="gc-client-secret">
              Client Secret{" "}
              {status.credentialsConfigured && (
                <span className="ml-1 text-[10px] text-green-500">(configured)</span>
              )}
            </label>
            <input
              id="gc-client-secret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={
                status.credentialsConfigured ? "•••• leave blank to keep existing" : "GOCSPX-..."
              }
              disabled={!status.uvxInstalled}
              className="w-full rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 text-[12px] text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none disabled:opacity-50"
            />
          </div>
          {credentialsError && <p className="text-[11px] text-red-500">{credentialsError}</p>}
          <button
            type="button"
            onClick={saveCredentials}
            disabled={
              !status.uvxInstalled || savingCreds || !clientId.trim() || !clientSecret.trim()
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-40"
          >
            <FiKey size={12} />
            {savingCreds ? "Saving..." : "Save credentials"}
          </button>
        </div>
      </div>

      {/* Step 3: Authorize */}
      <div
        className={`rounded-xl border border-canvas-border bg-canvas-surface p-4 ${
          !status.credentialsConfigured ? "opacity-50" : ""
        }`}
      >
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
          Step 3 — Sign in with Google
        </p>
        <p className="mb-3 text-[11px] text-canvas-muted">
          Pick the Google account you want to use in the account picker. You&apos;ll see an
          &quot;unverified app&quot; warning — click{" "}
          <span className="font-medium">Advanced → Go to …</span> to continue. It&apos;s safe since
          you own the OAuth app.
        </p>
        <button
          type="button"
          onClick={startAuthorize}
          disabled={!status.credentialsConfigured}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-40"
        >
          <FiExternalLink size={12} />
          Sign in with Google
        </button>
      </div>

      {authorizedEmail && (
        <p className="text-[11px] text-green-500">Authorized as {authorizedEmail}</p>
      )}
    </div>
  );
}
