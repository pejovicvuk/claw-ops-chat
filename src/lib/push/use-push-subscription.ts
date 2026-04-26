"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/auth";
import { DEFAULT_PREFERENCES, type DeviceSummary, type EventPreferences } from "./types";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

/**
 * Resolve `promise` within `ms`, otherwise reject with a timeout error.
 * Used to ensure a stuck `serviceWorker.ready` (which can hang
 * indefinitely if a worker never reaches "active") surfaces as a
 * visible error instead of an eternal loading spinner.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${label} (${ms} ms)`)),
      ms,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export type PushSupport = { kind: "supported" } | { kind: "unsupported"; reason: string };

export interface UsePushSubscriptionResult {
  support: PushSupport;
  permission: NotificationPermission;
  /** Subscription state for THIS browser. */
  thisDevice: DeviceSummary | null;
  /** Subscriptions for ALL of the user's devices. */
  allDevices: DeviceSummary[];
  loading: boolean;
  enabling: boolean;
  error: string | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  setPrefs: (events: Partial<EventPreferences>) => Promise<void>;
  removeDevice: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  sendTest: () => Promise<void>;
  refresh: () => Promise<void>;
}

function detectSupport(): PushSupport {
  if (typeof window === "undefined") return { kind: "unsupported", reason: "ssr" };
  if (!("serviceWorker" in navigator)) {
    return { kind: "unsupported", reason: "Service workers are not available in this browser." };
  }
  if (!("PushManager" in window)) {
    return { kind: "unsupported", reason: "Push notifications are not available in this browser." };
  }
  if (typeof Notification === "undefined") {
    return {
      kind: "unsupported",
      reason: "The Notification API is not available in this browser.",
    };
  }
  return { kind: "supported" };
}

function deriveLabel(): string {
  if (typeof navigator === "undefined") return "Unknown device";
  const ua = navigator.userAgent;
  // Cheap "Browser on OS" derivation. Server is the source of truth for
  // long-term identity; this just gives the user a recognizable name.
  let browser = "Browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = "Safari";

  let os = "Unknown OS";
  if (/Windows NT/.test(ua)) os = "Windows";
  else if (/Macintosh/.test(ua)) os = "macOS";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Linux/.test(ua)) os = "Linux";

  return `${browser} on ${os}`;
}

function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

interface ServerListResponse {
  devices: DeviceSummary[];
  thisDeviceId: string | null;
}

async function fetchVapidPublicKey(): Promise<string> {
  const res = await authFetch(`${BASE}/api/push/vapid-key`);
  if (!res.ok) throw new Error(`Failed to fetch VAPID key (${res.status})`);
  const body = (await res.json()) as { publicKey: string };
  return body.publicKey;
}

async function fetchDevices(currentEndpoint?: string): Promise<ServerListResponse> {
  const url = currentEndpoint
    ? `${BASE}/api/push/subscriptions?currentEndpoint=${encodeURIComponent(currentEndpoint)}`
    : `${BASE}/api/push/subscriptions`;
  const res = await authFetch(url);
  if (!res.ok) throw new Error(`Failed to load devices (${res.status})`);
  return (await res.json()) as ServerListResponse;
}

export function usePushSubscription(): UsePushSubscriptionResult {
  const [support] = useState<PushSupport>(() => detectSupport());
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification !== "undefined" ? Notification.permission : "default",
  );
  const [thisDevice, setThisDevice] = useState<DeviceSummary | null>(null);
  const [allDevices, setAllDevices] = useState<DeviceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabling, setEnabling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (support.kind !== "supported") {
      setLoading(false);
      return;
    }
    try {
      setError(null);
      // `getRegistration()` resolves immediately (with `undefined` when
      // no SW exists) — unlike `.ready`, which hangs forever if no
      // worker ever activates. The read path must never block on `.ready`.
      const reg = await withTimeout(
        navigator.serviceWorker.getRegistration(`${BASE}/`),
        3000,
        "service worker registration lookup",
      );
      let endpoint: string | undefined;
      if (reg) {
        try {
          const sub = await withTimeout(
            reg.pushManager.getSubscription(),
            3000,
            "push subscription lookup",
          );
          endpoint = sub?.endpoint;
        } catch {
          /* leave endpoint undefined; server still returns the device list */
        }
      }
      const list = await fetchDevices(endpoint);
      setAllDevices(list.devices);
      setThisDevice(list.devices.find((d) => d.isThisDevice) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load devices");
    } finally {
      setLoading(false);
    }
  }, [support.kind]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    if (support.kind !== "supported" || enabling) return;
    setEnabling(true);
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        throw new Error(
          perm === "denied"
            ? "Browser blocked notifications. Allow them in site settings to enable."
            : "Notification permission was not granted.",
        );
      }
      const reg = await navigator.serviceWorker.register(`${BASE}/sw.js`, { scope: `${BASE}/` });
      await withTimeout(navigator.serviceWorker.ready, 10_000, "service worker activation");
      const publicKey = await fetchVapidPublicKey();
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBuffer(publicKey),
        });
      }
      const json = sub.toJSON();
      const res = await authFetch(`${BASE}/api/push/subscriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: { endpoint: sub.endpoint, keys: json.keys },
          label: deriveLabel(),
          events: DEFAULT_PREFERENCES,
        }),
      });
      if (!res.ok) throw new Error(`Failed to register device (${res.status})`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable notifications");
    } finally {
      setEnabling(false);
    }
  }, [support.kind, enabling, refresh]);

  const disable = useCallback(async () => {
    if (support.kind !== "supported") return;
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration(`${BASE}/`);
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub && thisDevice) {
        await authFetch(`${BASE}/api/push/subscriptions/${thisDevice.id}`, { method: "DELETE" });
      }
      if (sub) await sub.unsubscribe();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable notifications");
    }
  }, [support.kind, thisDevice, refresh]);

  const setPrefs = useCallback(
    async (events: Partial<EventPreferences>) => {
      if (!thisDevice) return;
      setError(null);
      try {
        const res = await authFetch(`${BASE}/api/push/subscriptions/${thisDevice.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events }),
        });
        if (!res.ok) throw new Error(`Failed to update preferences (${res.status})`);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update preferences");
      }
    },
    [thisDevice, refresh],
  );

  const removeDevice = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const res = await authFetch(`${BASE}/api/push/subscriptions/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`Failed to remove device (${res.status})`);
        // If we removed THIS device, also unsubscribe locally so the
        // browser stops receiving messages for the orphaned subscription.
        if (thisDevice && thisDevice.id === id) {
          const reg = await navigator.serviceWorker.getRegistration(`${BASE}/`);
          const sub = reg ? await reg.pushManager.getSubscription() : null;
          await sub?.unsubscribe();
        }
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove device");
      }
    },
    [thisDevice, refresh],
  );

  const clearAll = useCallback(async () => {
    setError(null);
    try {
      const res = await authFetch(`${BASE}/api/push/subscriptions?all=true`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Failed to clear devices (${res.status})`);
      const reg = await navigator.serviceWorker.getRegistration(`${BASE}/`);
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      await sub?.unsubscribe();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear devices");
    }
  }, [refresh]);

  const sendTest = useCallback(async () => {
    setError(null);
    try {
      const res = await authFetch(`${BASE}/api/push/test`, { method: "POST" });
      if (!res.ok) throw new Error(`Failed to send test (${res.status})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send test notification");
    }
  }, []);

  return {
    support,
    permission,
    thisDevice,
    allDevices,
    loading,
    enabling,
    error,
    enable,
    disable,
    setPrefs,
    removeDevice,
    clearAll,
    sendTest,
    refresh,
  };
}
