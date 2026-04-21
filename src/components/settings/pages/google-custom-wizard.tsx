"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FiAlertTriangle,
  FiCheck,
  FiCopy,
  FiDownload,
  FiExternalLink,
  FiKey,
  FiLoader,
  FiLogOut,
  FiRefreshCw,
  FiTerminal,
  FiUpload,
  FiX,
} from "react-icons/fi";
import { authFetch } from "@/lib/auth";
import { GoogleSetupTerminal } from "@/components/settings/google-setup-terminal";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

type ServerPlatform = "win32" | "linux" | "darwin" | string;
type ClientType = "installed" | "web" | null;

interface Status {
  uvxInstalled: boolean;
  uvBinaryFound?: boolean;
  credentialsConfigured: boolean;
  connected: boolean;
  clientType?: ClientType;
  accountEmail?: string | null;
  platform?: ServerPlatform;
  powershell?: string | null;
  downloader?: "curl" | "wget" | null;
}

type UiMode =
  | "loading"
  | "setup"
  | "device-flow" // Desktop-client path: code + polling
  | "authorizing" // Web-client legacy redirect path
  | "connected"
  | "error";

interface DeviceStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  verificationUrlComplete: string;
  expiresIn: number;
  interval: number;
}

/**
 * Try to parse a pasted credentials.json into clientId + clientSecret +
 * client type. Accepts both Google OAuth shapes:
 *   { "installed": { client_id, client_secret, ... } }  → Desktop
 *   { "web":       { client_id, client_secret, ... } }  → Web
 * Returns null if the JSON is invalid or doesn't match either shape — the
 * UI surfaces a specific error in that case.
 */
function parseCredentialsJson(raw: string): {
  clientId: string;
  clientSecret: string;
  clientType: "installed" | "web";
} | null {
  try {
    const parsed = JSON.parse(raw) as {
      installed?: { client_id?: string; client_secret?: string };
      web?: { client_id?: string; client_secret?: string };
    };
    if (parsed.installed?.client_id && parsed.installed.client_secret) {
      return {
        clientId: parsed.installed.client_id,
        clientSecret: parsed.installed.client_secret,
        clientType: "installed",
      };
    }
    if (parsed.web?.client_id && parsed.web.client_secret) {
      return {
        clientId: parsed.web.client_id,
        clientSecret: parsed.web.client_secret,
        clientType: "web",
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * "Use a different Google account" wizard.
 * Renders below the hosted claude.ai connectors on the Google Workspace page.
 */
export function GoogleCustomWizard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<UiMode>("loading");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  // Client-parsed credentials.json — read from an uploaded file. Stored as
  // a string so it lands on the server exactly the way the credentials
  // endpoint expects (the { json } POST body).
  const [jsonPaste, setJsonPaste] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [detectedType, setDetectedType] = useState<"installed" | "web" | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);
  const [credentialsError, setCredentialsError] = useState<string | null>(null);

  // Device-flow state (Desktop clients)
  const [device, setDevice] = useState<DeviceStartResponse | null>(null);
  const [devicePolling, setDevicePolling] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIntervalRef = useRef<number>(5);
  const pollExpiryRef = useRef<number>(0);
  const [nowTick, setNowTick] = useState(0);

  // Legacy web-redirect SSE state (kept for Web clients)
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [authorizedEmail, setAuthorizedEmail] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);
  const [urlCopied, setUrlCopied] = useState(false);

  // Terminal-based setup state
  const [setupTerminal, setSetupTerminal] = useState<{
    command: string;
    callbackUrl: string;
  } | null>(null);
  const [setupBooting, setSetupBooting] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/google-custom/status`);
      if (!res.ok) throw new Error("status");
      const data = (await res.json()) as Status;
      setStatus(data);
      if (data.accountEmail) setSignedInEmail(data.accountEmail);
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

  // Parse the credentials.json contents in the browser so the user sees
  // the detected client type before they even hit Save. The same string
  // lands on the server via the { json } POST body — the server repeats
  // the parse for validation.
  const handleParsedJson = useCallback((raw: string) => {
    setJsonPaste(raw);
    setJsonError(null);
    if (!raw.trim()) {
      setDetectedType(null);
      return;
    }
    const parsed = parseCredentialsJson(raw);
    if (!parsed) {
      setDetectedType(null);
      setJsonError(
        "Couldn't find client_id / client_secret in that JSON. Expected either an " +
          '"installed" (Desktop) or "web" (Web application) block.',
      );
      return;
    }
    setDetectedType(parsed.clientType);
    // Auto-fill the two manual fields so the user can inspect / edit if
    // needed, and so the Save button enables without extra tabbing.
    setClientId(parsed.clientId);
    setClientSecret(parsed.clientSecret);
  }, []);

  // File-upload entrypoint: read the picked file as text, then reuse the
  // same validation path as the manual fields.
  const onJsonFilePicked = useCallback(
    (file: File | null | undefined) => {
      if (!file) return;
      setUploadedFileName(file.name);
      setJsonError(null);
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === "string" ? reader.result : "";
        handleParsedJson(text);
      };
      reader.onerror = () => {
        setJsonError("Could not read that file.");
        setDetectedType(null);
      };
      reader.readAsText(file);
    },
    [handleParsedJson],
  );

  const clearUploadedJson = useCallback(() => {
    setUploadedFileName(null);
    setJsonPaste("");
    setDetectedType(null);
    setJsonError(null);
    setClientId("");
    setClientSecret("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const saveCredentials = useCallback(async () => {
    const usingJson = jsonPaste.trim().length > 0;
    if (!usingJson && (!clientId.trim() || !clientSecret.trim())) return;
    if (savingCreds) return;

    setSavingCreds(true);
    setCredentialsError(null);
    try {
      const payload = usingJson
        ? { json: jsonPaste }
        : { clientId: clientId.trim(), clientSecret: clientSecret.trim() };
      const res = await authFetch(`${BASE}/api/google-custom/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Failed to save credentials");
      }
      // Clear the parsed JSON + secret so nothing lingers in the DOM after
      // save. Filename is cleared too so the user sees a fresh state if
      // they come back to edit.
      setJsonPaste("");
      setUploadedFileName(null);
      setClientSecret("");
      setDetectedType(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await refreshStatus();
    } catch (err) {
      setCredentialsError(err instanceof Error ? err.message : "Failed to save credentials");
    } finally {
      setSavingCreds(false);
    }
  }, [clientId, clientSecret, jsonPaste, savingCreds, refreshStatus]);

  // ─────────── Device Flow (Desktop clients) ───────────

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setDevicePolling(false);
  }, []);

  const pollOnce = useCallback(
    async (deviceCode: string) => {
      if (Date.now() > pollExpiryRef.current) {
        setDeviceError("The sign-in code expired. Click Sign in again to get a new one.");
        stopPolling();
        return;
      }
      try {
        const res = await authFetch(`${BASE}/api/google-custom/device-poll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceCode }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          status?: string;
          email?: string;
          error?: string;
        };
        if (data.status === "success") {
          setSignedInEmail(data.email ?? null);
          stopPolling();
          setDevice(null);
          await refreshStatus();
          return;
        }
        if (data.status === "slow_down") {
          pollIntervalRef.current = Math.min(pollIntervalRef.current * 2, 30);
        } else if (data.status === "pending") {
          // keep polling at current interval
        } else if (data.status === "error") {
          setDeviceError(data.error || "Sign-in failed");
          stopPolling();
          return;
        } else if (!res.ok) {
          setDeviceError(data.error || `HTTP ${res.status}`);
          stopPolling();
          return;
        }
        pollTimerRef.current = setTimeout(
          () => void pollOnce(deviceCode),
          pollIntervalRef.current * 1000,
        );
      } catch (err) {
        setDeviceError(err instanceof Error ? err.message : "Network error while polling");
        stopPolling();
      }
    },
    [refreshStatus, stopPolling],
  );

  const startDeviceFlow = useCallback(async () => {
    setMode("device-flow");
    setDevice(null);
    setDeviceError(null);
    setSignedInEmail(null);
    setDevicePolling(true);
    try {
      const res = await authFetch(`${BASE}/api/google-custom/device-start`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as
        | (DeviceStartResponse & { error?: undefined })
        | { error: string };
      if (!res.ok || "error" in data) {
        throw new Error(("error" in data && data.error) || `HTTP ${res.status}`);
      }
      setDevice(data);
      pollIntervalRef.current = data.interval || 5;
      pollExpiryRef.current = Date.now() + (data.expiresIn || 1800) * 1000;
      pollTimerRef.current = setTimeout(
        () => void pollOnce(data.deviceCode),
        pollIntervalRef.current * 1000,
      );
    } catch (err) {
      setDeviceError(err instanceof Error ? err.message : "Failed to start sign-in");
      setDevicePolling(false);
    }
  }, [pollOnce]);

  // Tick the "expires in N:NN" label once per second while polling.
  useEffect(() => {
    if (!devicePolling) return;
    const id = setInterval(() => setNowTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [devicePolling]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  const copyUserCode = useCallback(async () => {
    if (!device) return;
    try {
      await navigator.clipboard.writeText(device.userCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }, [device]);

  // ─────────── Legacy Web-redirect flow (Web clients only) ───────────

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
    stopPolling();
    setClientId("");
    setClientSecret("");
    setJsonPaste("");
    setUploadedFileName(null);
    setDetectedType(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setAuthUrl(null);
    setAuthorizedEmail(null);
    setSignedInEmail(null);
    setDevice(null);
    setLogs([]);
    await refreshStatus();
  }, [refreshStatus, stopPolling]);

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

  // Interactive-terminal setup path (Web-client redirect flow — kept as
  // a fallback for users who already had it working).
  const openSetupTerminal = useCallback(async () => {
    if (setupBooting) return;
    setSetupBooting(true);
    setSetupError(null);
    try {
      const res = await authFetch(`${BASE}/api/google-custom/setup-script`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Setup failed (${res.status})`);
      }
      const data = (await res.json()) as { scriptPath: string; callbackUrl: string };
      setSetupTerminal({
        command: `bash ${data.scriptPath}`,
        callbackUrl: data.callbackUrl,
      });
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "Failed to prepare setup");
    } finally {
      setSetupBooting(false);
    }
  }, [setupBooting]);

  const closeSetupTerminal = useCallback(() => {
    setSetupTerminal(null);
    void refreshStatus();
  }, [refreshStatus]);

  // ───────────────────── Rendering ─────────────────────

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
            {status.accountEmail ? (
              <>
                Signed in as <span className="font-mono text-canvas-fg">{status.accountEmail}</span>
                . Claude Code will use this connection for Gmail, Drive, Calendar, Docs, and Sheets.
              </>
            ) : (
              <>
                Claude Code will use this connection for Gmail, Drive, Calendar, Docs, and Sheets.
              </>
            )}{" "}
            Restart the dev server after any change for it to take effect.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={status.clientType === "installed" ? startDeviceFlow : startAuthorize}
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

  if (mode === "device-flow") {
    const msLeft = Math.max(0, pollExpiryRef.current - Date.now());
    const minutes = Math.floor(msLeft / 60000);
    const seconds = Math.floor((msLeft % 60000) / 1000);
    const timeLabel = `${minutes}:${seconds.toString().padStart(2, "0")}`;
    // nowTick is referenced so React re-renders every second while polling;
    // the `msLeft` computation above relies on Date.now() which doesn't
    // itself trigger a render.
    void nowTick;

    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-canvas-border bg-canvas-surface p-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
            Sign in with Google
          </p>

          {signedInEmail ? (
            <div className="flex items-center gap-2 rounded-lg bg-green-500/10 px-3 py-2 text-[12px] text-green-600">
              <FiCheck size={12} />
              Signed in as <span className="font-mono">{signedInEmail}</span>
            </div>
          ) : device ? (
            <>
              <p className="mb-3 text-[11px] leading-relaxed text-canvas-muted">
                Enter this code at{" "}
                <a
                  href={device.verificationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline"
                >
                  {device.verificationUrl.replace(/^https?:\/\//, "")}
                </a>
                , or just click the sign-in button below — it opens a link that already includes the
                code.
              </p>

              <div className="mb-3 flex items-center gap-2 rounded-lg bg-canvas-bg px-3 py-3">
                <code className="flex-1 text-center font-mono text-[20px] font-semibold tracking-[0.3em] text-canvas-fg">
                  {device.userCode}
                </code>
                <button
                  type="button"
                  onClick={copyUserCode}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
                >
                  {codeCopied ? <FiCheck size={11} /> : <FiCopy size={11} />}
                  {codeCopied ? "Copied" : "Copy"}
                </button>
              </div>

              <a
                href={device.verificationUrlComplete}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white transition-colors hover:opacity-90"
              >
                <FiExternalLink size={12} />
                Open Google to sign in
              </a>

              <div className="mt-3 flex items-center gap-2 text-[11px] text-canvas-muted">
                <FiLoader size={11} className="animate-spin" />
                Waiting for you to approve… (expires in {timeLabel})
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 text-[12px] text-canvas-muted">
              <FiLoader size={12} className="animate-spin" />
              Getting a code from Google…
            </div>
          )}

          {deviceError && (
            <p className="mt-3 flex items-start gap-1 text-[11px] text-red-500">
              <FiAlertTriangle size={10} className="mt-[2px] shrink-0" />
              {deviceError}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          {deviceError && (
            <button
              type="button"
              onClick={startDeviceFlow}
              className="rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white hover:opacity-90"
            >
              Try again
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              stopPolling();
              setDevice(null);
              setDeviceError(null);
              setMode("setup");
            }}
            className="rounded-lg px-3 py-2 text-[12px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            Cancel
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
  const savedType = status.clientType ?? null;
  const effectiveType: ClientType = detectedType ?? savedType;
  const canSave =
    status.uvxInstalled &&
    !savingCreds &&
    (jsonPaste.trim().length > 0 || (clientId.trim().length > 0 && clientSecret.trim().length > 0));
  const canSignIn = status.credentialsConfigured && !savingCreds;

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-canvas-muted">
        Connect a Google account that&apos;s separate from the one linked to your Claude.ai
        subscription. This creates a local MCP server using credentials you provide — tokens stay on
        your machine.
      </p>

      {/* Step 1: uvx check + installer */}
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
          <PrereqInstaller status={status} onInstalled={refreshStatus} />
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
              → Create Credentials → OAuth client ID → pick{" "}
              <span className="font-medium text-canvas-fg">Web application</span>.
            </li>
            <li>
              Under <span className="font-medium text-canvas-fg">Authorized redirect URIs</span>,
              add this exact URL:
              <code className="mt-1 block overflow-x-auto rounded bg-canvas-bg px-2 py-1 text-[10px] text-canvas-fg">
                https://&lt;your-host&gt;/chat/api/google-custom/oauth-callback
              </code>
              Replace <code>&lt;your-host&gt;</code> with the domain you access this app on (e.g.{" "}
              <code>vukasin-claude.viksi.ai</code>).
            </li>
            <li>
              Click <span className="font-medium text-canvas-fg">Download JSON</span> on the client
              row and upload the file below. Then use the &quot;Run Setup in Terminal&quot; button
              in Step 3 to finish sign-in.
            </li>
            <li className="text-canvas-muted/80">
              <span className="font-medium">Why not Desktop app or TVs and Limited Input?</span>{" "}
              Desktop clients can&apos;t register a public https redirect, and Google&apos;s device
              flow (TVs / Limited Input) only allows identity, YouTube, and file-scoped Drive — no
              Gmail, no Calendar, no Docs/Sheets. Web application is the only type that works for
              full Workspace access on a remote host.
            </li>
          </ol>
        )}

        {/* credentials.json upload (primary) */}
        <div className="mb-3">
          <label className="mb-1 block text-[11px] text-canvas-muted">
            Upload <code className="text-canvas-fg">credentials.json</code>
          </label>
          {/* Hidden file input — click is proxied from the visible button.
              Parsing, detection, and field auto-fill happen in
              onJsonFilePicked. The file contents never leave the browser
              except as part of the eventual Save POST body. */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => onJsonFilePicked(e.target.files?.[0])}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!status.uvxInstalled}
              className="inline-flex items-center gap-1.5 rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 text-[12px] font-medium text-canvas-fg transition-colors hover:bg-canvas-surface-hover disabled:opacity-50"
            >
              <FiUpload size={12} />
              {uploadedFileName ? "Replace file" : "Choose credentials.json"}
            </button>
            {uploadedFileName && (
              <>
                <span className="inline-flex items-center gap-1 rounded-md bg-canvas-surface-hover px-2 py-1 font-mono text-[11px] text-canvas-fg">
                  {uploadedFileName}
                </span>
                <button
                  type="button"
                  onClick={clearUploadedJson}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
                  title="Clear uploaded file"
                >
                  <FiX size={11} />
                  Clear
                </button>
              </>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[11px]">
            {detectedType === "installed" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-green-600">
                <FiCheck size={10} />
                Desktop client detected — device flow will be used
              </span>
            )}
            {detectedType === "web" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-blue-600">
                <FiCheck size={10} />
                Web client detected — redirect flow will be used
              </span>
            )}
            {jsonError && (
              <span className="inline-flex items-start gap-1 text-red-500">
                <FiAlertTriangle size={10} className="mt-[2px] shrink-0" />
                {jsonError}
              </span>
            )}
          </div>
        </div>

        {/* Manual fallback fields */}
        <details className="mb-3">
          <summary className="cursor-pointer text-[11px] text-canvas-muted hover:text-canvas-fg">
            Enter Client ID / Secret manually instead
          </summary>
          <div className="mt-2 space-y-2">
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
              <label
                className="mb-1 block text-[11px] text-canvas-muted"
                htmlFor="gc-client-secret"
              >
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
          </div>
        </details>

        {credentialsError && <p className="mb-2 text-[11px] text-red-500">{credentialsError}</p>}

        <button
          type="button"
          onClick={saveCredentials}
          disabled={!canSave}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-40"
        >
          <FiKey size={12} />
          {savingCreds
            ? "Saving..."
            : status.credentialsConfigured
              ? "Update credentials"
              : "Save credentials"}
        </button>
      </div>

      {/* Step 3: Sign in */}
      <div
        className={`rounded-xl border border-canvas-border bg-canvas-surface p-4 ${
          !status.credentialsConfigured ? "opacity-50" : ""
        }`}
      >
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
          Step 3 — Sign in with Google
        </p>

        {effectiveType === "installed" ? (
          <>
            <p className="mb-3 text-[11px] leading-relaxed text-canvas-muted">
              We&apos;ll use Google&apos;s device flow — no redirect URL needed. You&apos;ll get a
              code to enter on any device.{" "}
              <span className="font-medium text-canvas-fg">
                Your OAuth client must be registered as &quot;TVs and Limited Input devices&quot;
              </span>{" "}
              — Google rejects Desktop-app clients here with &quot;Invalid client type&quot;. Both
              types produce identical JSON, so paste-time detection can&apos;t tell them apart.
            </p>
            <button
              type="button"
              onClick={startDeviceFlow}
              disabled={!canSignIn}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-40"
            >
              <FiExternalLink size={12} />
              Sign in with Google
            </button>
          </>
        ) : (
          <>
            <p className="mb-3 text-[11px] leading-relaxed text-canvas-muted">
              Pick the Google account you want to use in the account picker. You&apos;ll see an
              &quot;unverified app&quot; warning — click{" "}
              <span className="font-medium">Advanced → Go to …</span> to continue. It&apos;s safe
              since you own the OAuth app.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openSetupTerminal}
                disabled={!canSignIn || setupBooting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-40"
              >
                <FiTerminal size={12} />
                {setupBooting ? "Preparing…" : "Run Setup in Terminal"}
              </button>
              <button
                type="button"
                onClick={startAuthorize}
                disabled={!canSignIn}
                className="inline-flex items-center gap-1.5 rounded-lg border border-canvas-border px-3 py-2 text-[12px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:opacity-40"
                title="Legacy SSE flow — use the terminal path above if this hangs"
              >
                <FiExternalLink size={12} />
                Classic sign-in
              </button>
            </div>
            <p className="mt-2 text-[10px] text-canvas-muted">
              The terminal path runs <code>uvx workspace-mcp</code> in a live PTY inside the
              container and proxies Google&apos;s OAuth callback back through the chat&apos;s public
              URL — use it when the classic sign-in hangs on a remote deployment.
            </p>
          </>
        )}

        {setupError && (
          <p className="mt-2 flex items-center gap-1 text-[11px] text-red-500">
            <FiAlertTriangle size={10} />
            {setupError}
          </p>
        )}
      </div>

      {authorizedEmail && (
        <p className="text-[11px] text-green-500">Authorized as {authorizedEmail}</p>
      )}

      {setupTerminal && (
        <GoogleSetupTerminal
          initialCommand={setupTerminal.command}
          callbackUrl={setupTerminal.callbackUrl}
          onClose={closeSetupTerminal}
        />
      )}
    </div>
  );
}

interface PrereqInstallerProps {
  status: Status;
  onInstalled: () => void | Promise<void>;
}

/**
 * Inline installer for `uv` / `uvx`. Streams output from
 * /api/prereqs/install-uv (SSE) and auto-refreshes status on success.
 */
function PrereqInstaller({ status, onInstalled }: PrereqInstallerProps) {
  const serverPlatform = status.platform;
  const [installing, setInstalling] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const isWindows = serverPlatform === "win32";
  const isUnix = serverPlatform === "linux" || serverPlatform === "darwin";

  // Reason the Install button can't run, if any.
  let blockReason: string | null = null;
  if (isWindows && status.powershell === null) {
    blockReason =
      "PowerShell wasn't found on the server. Install uv manually: " +
      "irm https://astral.sh/uv/install.ps1 | iex";
  } else if (isUnix && status.downloader === null) {
    blockReason =
      "Neither curl nor wget is installed on the server. " + "Install one of them, then refresh.";
  }

  const runInstall = useCallback(async () => {
    if (installing || blockReason) return;
    setInstalling(true);
    setLogs([]);
    setError(null);
    setDone(false);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await authFetch(`${BASE}/api/prereqs/install-uv`, {
        method: "POST",
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error("Failed to start install");

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
            if (evt.type === "log") {
              setLogs((prev) => [...prev, evt.line as string].slice(-100));
            } else if (evt.type === "done") {
              if (evt.success) {
                setDone(true);
                await onInstalled();
              } else {
                setError((evt.error as string) || "Install failed");
              }
              return;
            }
          } catch {
            /* malformed */
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Install error");
    } finally {
      setInstalling(false);
    }
  }, [installing, blockReason, onInstalled]);

  const cancel = useCallback(async () => {
    abortRef.current?.abort();
    try {
      await authFetch(`${BASE}/api/prereqs/install-uv/cancel`, { method: "POST" });
    } catch {
      /* best-effort */
    }
  }, []);

  if (done) {
    return (
      <div className="text-[12px] text-green-500">
        <FiCheck size={13} className="-mt-0.5 mr-1 inline" />
        uvx installed — ready to continue.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[12px] text-canvas-muted">
        <code className="text-[11px]">uvx</code> isn&apos;t on this server yet. Install it now:
      </p>
      {blockReason && (
        <p className="rounded-md bg-yellow-500/10 px-2 py-1.5 text-[11px] text-yellow-600">
          {blockReason}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={runInstall}
          disabled={installing || !!blockReason}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-40"
        >
          <FiDownload size={12} />
          {installing ? "Installing..." : "Install uv"}
        </button>
        {installing && (
          <button
            type="button"
            onClick={cancel}
            className="inline-flex items-center gap-1.5 rounded-lg border border-canvas-border px-3 py-2 text-[12px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            Cancel
          </button>
        )}
      </div>
      {logs.length > 0 && (
        <pre className="max-h-40 overflow-y-auto rounded-md bg-canvas-bg p-2 font-mono text-[10px] leading-relaxed text-canvas-muted">
          {logs.join("\n")}
        </pre>
      )}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
