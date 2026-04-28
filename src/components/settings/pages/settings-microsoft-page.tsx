"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FiAlertTriangle,
  FiCheck,
  FiChevronDown,
  FiChevronRight,
  FiCopy,
  FiExternalLink,
  FiKey,
  FiLoader,
  FiLogOut,
  FiRefreshCw,
} from "react-icons/fi";
import { authFetch } from "@/lib/auth";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

interface StatusResponse {
  connected: boolean;
  credentialsSaved: boolean;
  accountEmail: string | null;
  displayName: string | null;
  tokenExpired: boolean;
  refreshError?: string;
}

interface DeviceStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
  message: string | null;
}

type UiMode = "loading" | "app-setup" | "device-flow" | "connected";

export function SettingsMicrosoftPage() {
  const [mode, setMode] = useState<UiMode>("loading");
  const [statusData, setStatusData] = useState<StatusResponse | null>(null);

  // app-setup form state
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [tenantId, setTenantId] = useState("common");
  const [showSecret, setShowSecret] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [credError, setCredError] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);

  // device-flow state
  const [device, setDevice] = useState<DeviceStartResponse | null>(null);
  const [devicePolling, setDevicePolling] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);

  // Polling refs — survive re-renders without causing extra renders
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIntervalRef = useRef<number>(5);
  const expiryTsRef = useRef<number>(0);
  const mountedRef = useRef(true);

  // Increments every second while polling to keep the countdown live
  const [nowTick, setNowTick] = useState(0);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (mode !== "device-flow" || !devicePolling) return;
    const id = setInterval(() => setNowTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [mode, devicePolling]);

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/microsoft-custom/status`);
      if (!res.ok) throw new Error("status");
      const data = (await res.json()) as StatusResponse;
      setStatusData(data);
      setMode(data.connected ? "connected" : "app-setup");
    } catch {
      setStatusData(null);
      setMode("app-setup");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const schedulePoll = useCallback(
    (deviceCode: string, intervalSec: number) => {
      pollIntervalRef.current = intervalSec;
      pollTimerRef.current = setTimeout(async () => {
        if (!mountedRef.current) return;
        try {
          const res = await authFetch(`${BASE}/api/microsoft-custom/device-poll`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deviceCode }),
          });
          const data = (await res.json()) as {
            status: "pending" | "slow_down" | "success" | "error";
            error?: string;
          };
          if (!mountedRef.current) return;
          if (data.status === "pending") {
            schedulePoll(deviceCode, pollIntervalRef.current);
          } else if (data.status === "slow_down") {
            schedulePoll(deviceCode, Math.min(pollIntervalRef.current * 2, 30));
          } else if (data.status === "success") {
            setDevicePolling(false);
            await refresh();
            if (mountedRef.current) setMode("connected");
          } else {
            setDeviceError(data.error ?? "Authorization failed");
            setDevicePolling(false);
          }
        } catch {
          if (!mountedRef.current) return;
          setDeviceError("Network error during authorization check. Please try again.");
          setDevicePolling(false);
        }
      }, intervalSec * 1000);
    },
    [refresh],
  );

  const startDeviceFlow = useCallback(async (): Promise<void> => {
    const res = await authFetch(`${BASE}/api/microsoft-custom/device-start`, { method: "POST" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Failed to start sign-in (${res.status})`);
    }
    const deviceData = (await res.json()) as DeviceStartResponse;
    expiryTsRef.current = Date.now() + deviceData.expiresIn * 1000;
    pollIntervalRef.current = deviceData.interval;
    setDevice(deviceData);
    setDeviceError(null);
    setDevicePolling(true);
    setMode("device-flow");
    schedulePoll(deviceData.deviceCode, deviceData.interval);
  }, [schedulePoll]);

  const handleSignIn = useCallback(async () => {
    if (signingIn) return;
    if (!clientId.trim()) { setCredError("Application (Client) ID is required"); return; }
    if (!tenantId.trim()) { setCredError("Tenant ID is required"); return; }

    setSigningIn(true);
    setCredError(null);

    try {
      const credRes = await authFetch(`${BASE}/api/microsoft-custom/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim() || undefined,
          tenantId: tenantId.trim(),
        }),
      });
      if (!credRes.ok) {
        const body = (await credRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to save credentials (${credRes.status})`);
      }
    } catch (e) {
      setCredError(e instanceof Error ? e.message : "Failed to save credentials");
      setSigningIn(false);
      return;
    }

    try {
      await startDeviceFlow();
    } catch (e) {
      setCredError(e instanceof Error ? e.message : "Failed to start Microsoft sign-in");
    } finally {
      setSigningIn(false);
    }
  }, [clientId, clientSecret, tenantId, signingIn, startDeviceFlow]);

  const handleRetry = useCallback(async () => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    setDeviceError(null);
    setDevicePolling(false);
    try {
      await startDeviceFlow();
    } catch (e) {
      setDeviceError(e instanceof Error ? e.message : "Failed to restart sign-in");
    }
  }, [startDeviceFlow]);

  const handleDisconnect = useCallback(async () => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    setDevicePolling(false);
    try {
      await authFetch(`${BASE}/api/microsoft-custom/credentials`, { method: "DELETE" });
    } catch {
      /* best-effort */
    }
    setClientId("");
    setClientSecret("");
    setTenantId("common");
    setDevice(null);
    setDeviceError(null);
    await refresh();
  }, [refresh]);

  // ── loading ──────────────────────────────────────────────────────────────

  if (mode === "loading") {
    return (
      <div className="flex items-center justify-center py-8 text-canvas-muted">
        <FiLoader size={14} className="animate-spin" />
      </div>
    );
  }

  // ── connected ────────────────────────────────────────────────────────────

  if (mode === "connected" && statusData) {
    return (
      <div className="space-y-4">
        {statusData.tokenExpired ? (
          <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4">
            <div className="mb-1 flex items-center gap-2">
              <FiAlertTriangle size={14} className="text-orange-500" />
              <span className="text-[13px] font-medium text-canvas-fg">
                Re-authorization required
              </span>
            </div>
            <p className="text-[12px] text-canvas-muted">
              {statusData.refreshError ??
                "The Microsoft access token has expired. Sign in again to restore access."}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
            <div className="mb-1 flex items-center gap-2">
              <FiCheck size={14} className="text-green-500" />
              <span className="text-[13px] font-medium text-canvas-fg">
                Microsoft 365 connected
              </span>
            </div>
            <p className="text-[12px] text-canvas-muted">
              {statusData.accountEmail ? (
                <>
                  Signed in as{" "}
                  <span className="font-medium text-canvas-fg">{statusData.accountEmail}</span>
                  {statusData.displayName ? ` (${statusData.displayName})` : ""}.{" "}
                </>
              ) : null}
              Claude can now access Mail, Calendar, Teams, and Files via the Microsoft Graph API.
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setMode("app-setup");
              setCredError(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-canvas-border px-3 py-2 text-[12px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            <FiKey size={11} />
            Change credentials
          </button>
          <button
            type="button"
            onClick={() => void handleDisconnect()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] font-medium text-red-500 transition-colors hover:bg-red-500/15"
          >
            <FiLogOut size={11} />
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  // ── device-flow ───────────────────────────────────────────────────────────

  if (mode === "device-flow" && device) {
    // nowTick increments every second, causing this block to re-render and
    // recompute Date.now() so the countdown stays live.
    const secsLeft = Math.max(
      0,
      Math.ceil((expiryTsRef.current - Date.now()) / 1000) - nowTick * 0,
    );
    const mins = Math.floor(secsLeft / 60);
    const secs = secsLeft % 60;
    const countdown = `${mins}:${secs.toString().padStart(2, "0")}`;

    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-canvas-border bg-canvas-surface p-4">
          <p className="mb-3 text-[12px] text-canvas-muted">
            Open{" "}
            <a
              href={device.verificationUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              microsoft.com/devicelogin <FiExternalLink size={10} />
            </a>{" "}
            and enter this code:
          </p>

          <div className="mb-4 flex items-center gap-3">
            <span className="font-mono text-[22px] font-semibold tracking-[0.25em] text-canvas-fg">
              {device.userCode}
            </span>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(device.userCode);
                setCodeCopied(true);
                setTimeout(() => setCodeCopied(false), 2000);
              }}
              className="rounded-lg border border-canvas-border px-2 py-1.5 text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
              title="Copy code"
            >
              {codeCopied ? (
                <FiCheck size={11} className="text-green-500" />
              ) : (
                <FiCopy size={11} />
              )}
            </button>
          </div>

          {devicePolling && (
            <div className="flex items-center gap-2 text-[12px] text-canvas-muted">
              <FiLoader size={12} className="animate-spin" />
              <span>Waiting for you to approve in Microsoft…</span>
              <span className="ml-auto font-mono text-[11px]">Expires {countdown}</span>
            </div>
          )}

          {deviceError && (
            <div className="mt-3 space-y-2">
              <p className="flex items-center gap-1 text-[11px] text-red-500">
                <FiAlertTriangle size={10} />
                {deviceError}
              </p>
              <button
                type="button"
                onClick={() => void handleRetry()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white transition-colors hover:opacity-90"
              >
                <FiRefreshCw size={11} />
                Try again
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
            setDevicePolling(false);
            setDevice(null);
            setDeviceError(null);
            setMode("app-setup");
          }}
          className="text-[11px] text-canvas-muted underline-offset-2 hover:text-canvas-fg hover:underline"
        >
          Cancel
        </button>
      </div>
    );
  }

  // ── app-setup (default) ───────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Azure App Registration instructions (collapsible) */}
      <div className="rounded-xl border border-canvas-border bg-canvas-surface">
        <button
          type="button"
          onClick={() => setShowInstructions((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-[12px] font-medium text-canvas-fg">
            Azure App Registration setup
          </span>
          {showInstructions ? (
            <FiChevronDown size={13} className="text-canvas-muted" />
          ) : (
            <FiChevronRight size={13} className="text-canvas-muted" />
          )}
        </button>
        {showInstructions && (
          <div className="border-t border-canvas-border px-4 pb-4 pt-3">
            <ol className="space-y-2 text-[11px] leading-relaxed text-canvas-muted">
              <li>
                1. Open{" "}
                <a
                  href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-accent hover:underline"
                >
                  Azure Portal → App Registrations <FiExternalLink size={9} />
                </a>{" "}
                and click <strong className="text-canvas-fg">New registration</strong>.
              </li>
              <li>
                2. Set supported account types to{" "}
                <strong className="text-canvas-fg">
                  Accounts in any organizational directory and personal Microsoft accounts
                </strong>
                . No redirect URI needed.
              </li>
              <li>
                3. After registering, copy the{" "}
                <strong className="text-canvas-fg">Application (client) ID</strong> from the
                Overview page.
              </li>
              <li>
                4. Go to{" "}
                <strong className="text-canvas-fg">
                  Certificates &amp; secrets → New client secret
                </strong>
                , create one, and copy the <strong className="text-canvas-fg">Value</strong>.
              </li>
              <li>
                5. Go to{" "}
                <strong className="text-canvas-fg">
                  Authentication → Advanced settings → Allow public client flows
                </strong>{" "}
                → set to <strong className="text-canvas-fg">Yes</strong>.
              </li>
              <li>
                6. Go to{" "}
                <strong className="text-canvas-fg">
                  API permissions → Add a permission → Microsoft Graph → Delegated
                </strong>{" "}
                and add:{" "}
                {[
                  "User.Read",
                  "Mail.ReadWrite",
                  "Mail.Send",
                  "Calendars.ReadWrite",
                  "Contacts.ReadWrite",
                  "Files.ReadWrite.All",
                  "Tasks.ReadWrite",
                  "offline_access",
                ].map((s) => (
                  <code key={s} className="mx-0.5 rounded bg-canvas-bg px-1">
                    {s}
                  </code>
                ))}
                .
              </li>
              <li>
                7. Optionally add Teams permissions (
                <code className="rounded bg-canvas-bg px-1">Teams.ReadBasic.All</code>,{" "}
                <code className="rounded bg-canvas-bg px-1">ChannelMessage.Read.All</code>,{" "}
                <code className="rounded bg-canvas-bg px-1">Chat.ReadWrite</code>) — these require{" "}
                <strong className="text-canvas-fg">admin consent</strong> in org tenants and are
                not available for personal Microsoft accounts.
              </li>
            </ol>
          </div>
        )}
      </div>

      {/* Credentials form */}
      <div className="rounded-xl border border-canvas-border bg-canvas-surface p-4">
        <div className="space-y-3">
          <div>
            <label
              className="mb-1 block text-[11px] text-canvas-muted"
              htmlFor="ms-client-id"
            >
              Application (Client) ID
            </label>
            <input
              id="ms-client-id"
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="w-full rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[12px] text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div>
            <label
              className="mb-1 block text-[11px] text-canvas-muted"
              htmlFor="ms-client-secret"
            >
              Client Secret{" "}
              <span className="text-canvas-muted/60">(optional for public clients)</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                id="ms-client-secret"
                type={showSecret ? "text" : "password"}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="Leave blank if using public client flow"
                className="flex-1 rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[12px] text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                className="rounded-lg border border-canvas-border px-2 py-2 text-[11px] text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
              >
                {showSecret ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div>
            <label
              className="mb-1 block text-[11px] text-canvas-muted"
              htmlFor="ms-tenant-id"
            >
              Tenant ID
            </label>
            <input
              id="ms-tenant-id"
              type="text"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="common"
              className="w-full rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[12px] text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-1 text-[10px] text-canvas-muted">
              Use{" "}
              <code className="rounded bg-canvas-bg px-1">common</code> for personal +
              any org account. Enter your organization&apos;s Tenant ID GUID for
              single-tenant deployment.
            </p>
          </div>

          {credError && (
            <p className="flex items-center gap-1 text-[11px] text-red-500">
              <FiAlertTriangle size={10} />
              {credError}
            </p>
          )}

          <button
            type="button"
            onClick={() => void handleSignIn()}
            disabled={!clientId.trim() || !tenantId.trim() || signingIn}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-40"
          >
            {signingIn ? (
              <>
                <FiLoader size={11} className="animate-spin" />
                Starting…
              </>
            ) : (
              <>
                <FiCheck size={11} />
                Sign in with Microsoft
              </>
            )}
          </button>
        </div>
      </div>

      <p className="text-[10px] text-canvas-muted">
        Credentials are stored locally in{" "}
        <code>~/.claude/custom-microsoft/credentials.json</code> (mode 0600). The access
        token is passed to{" "}
        <code>@softeria/ms-365-mcp-server</code> as an env variable and is never sent
        anywhere other than Microsoft&apos;s authentication and Graph API servers.
      </p>
    </div>
  );
}
