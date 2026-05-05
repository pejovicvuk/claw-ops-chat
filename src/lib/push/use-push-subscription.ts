"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/auth";
import {
  DEFAULT_BEHAVIOR,
  DEFAULT_PREFERENCES,
  type BehaviorPreferences,
  type DeviceSummary,
  type EventPreferences,
  type PushEventKind,
} from "./types";

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

/**
 * Resolve once the registration has an `active` worker. State-aware
 * (vs. plain `.ready`) so we never block when activation has already
 * happened, and so a `redundant` worker — typically caused by a failed
 * install — surfaces as a real error instead of an indefinite hang.
 */
function waitForActivation(reg: ServiceWorkerRegistration): Promise<void> {
  if (reg.active) return Promise.resolve();
  const target = reg.installing ?? reg.waiting;
  if (!target) {
    // Nothing to listen on — fall back to global `.ready`, which
    // resolves once any worker becomes active for this scope.
    return navigator.serviceWorker.ready.then(() => undefined);
  }
  return new Promise<void>((resolve, reject) => {
    const onStateChange = () => {
      if (target.state === "activated") {
        target.removeEventListener("statechange", onStateChange);
        resolve();
      } else if (target.state === "redundant") {
        target.removeEventListener("statechange", onStateChange);
        reject(
          new Error(
            "Service worker became redundant during install (the install handler likely threw — try a hard reload).",
          ),
        );
      }
    };
    target.addEventListener("statechange", onStateChange);
    // Edge case: state may have flipped between the read and the
    // listener attach. Re-check synchronously.
    if (target.state === "activated") {
      target.removeEventListener("statechange", onStateChange);
      resolve();
    } else if (target.state === "redundant") {
      target.removeEventListener("statechange", onStateChange);
      reject(new Error("Service worker is redundant — try a hard reload."));
    }
  });
}

export type PushSupport = { kind: "supported" } | { kind: "unsupported"; reason: string };

export interface TestDeviceResult {
  label: string;
  outcome: "sent" | "dropped" | "error";
  statusCode?: number;
  detail?: string;
}

export interface TestSendResult {
  ok: boolean;
  kind: PushEventKind;
  attempted: number;
  sent: number;
  dropped: number;
  errored: number;
  devices: TestDeviceResult[];
}

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
  /** Update event preferences for THIS device. Thin wrapper around
   *  `setDevicePrefs(thisDevice.id, events)`. */
  setPrefs: (events: Partial<EventPreferences>) => Promise<void>;
  /** Update event preferences for any registered device by id. */
  setDevicePrefs: (id: string, events: Partial<EventPreferences>) => Promise<void>;
  /** Update focus behavior for THIS device. */
  setBehavior: (behavior: Partial<BehaviorPreferences>) => Promise<void>;
  /** Update focus behavior for any registered device by id. */
  setDeviceBehavior: (id: string, behavior: Partial<BehaviorPreferences>) => Promise<void>;
  removeDevice: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  /**
   * Fire a test notification on the given event channel (defaults to
   * turnComplete). Resolves with per-device delivery counts so the
   * caller can render a toast like "Sent 1 / 2 (1 dropped: 401)"
   * instead of an opaque success.
   */
  sendTest: (kind?: PushEventKind) => Promise<TestSendResult>;
  /**
   * Force the browser to mint a new `PushSubscription` on this device
   * and re-register it with the server, preserving the current event +
   * focus-behaviour preferences. Useful when the upstream push service
   * accepts deliveries (200) but the device-side never surfaces them
   * — typical iOS PWA failure mode after a notification-budget hit, an
   * iOS major upgrade, or a permission toggle in OS Settings. The old
   * server record naturally ages out the next time anything fires for
   * its now-orphaned endpoint (push service responds 410 → store drops).
   */
  refreshSubscription: () => Promise<void>;
  /** True while `refreshSubscription` is in flight. */
  refreshing: boolean;
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
  const [refreshing, setRefreshing] = useState(false);
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
      let pushSub: PushSubscription | null = null;
      if (reg) {
        try {
          pushSub = await withTimeout(
            reg.pushManager.getSubscription(),
            3000,
            "push subscription lookup",
          );
          endpoint = pushSub?.endpoint;
        } catch {
          /* leave endpoint undefined; server still returns the device list */
        }
      }
      const list = await fetchDevices(endpoint);
      setAllDevices(list.devices);
      setThisDevice(list.devices.find((d) => d.isThisDevice) ?? null);

      // Heartbeat: when the browser thinks it has a live subscription
      // but the server doesn't (or hasn't seen us in 24h), re-POST so
      // lastSeenAt is fresh and stale records are pruned. Eliminates
      // the "browser was reinstalled, server still thinks we're dead"
      // class of silent failures.
      if (pushSub && endpoint) {
        const known = list.devices.find((d) => d.isThisDevice);
        const stale = !known || Date.now() - known.lastSeenAt > 24 * 60 * 60 * 1000;
        if (stale) {
          const json = pushSub.toJSON();
          try {
            await authFetch(`${BASE}/api/push/subscriptions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                subscription: { endpoint: pushSub.endpoint, keys: json.keys },
                label: deriveLabel(),
                events: known?.events ?? DEFAULT_PREFERENCES,
                behavior: known?.behavior ?? DEFAULT_BEHAVIOR,
              }),
            });
          } catch {
            /* heartbeat is best-effort — don't surface as an error */
          }
        }
      }
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
      // State-aware wait: returns instantly if `reg.active` is already
      // truthy, listens for activation otherwise, surfaces `redundant`
      // (failed install) as a clean error. 30 s ceiling for slow nets.
      await withTimeout(waitForActivation(reg), 30_000, "service worker activation");
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
          behavior: DEFAULT_BEHAVIOR,
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

  const setDevicePrefs = useCallback(
    async (id: string, events: Partial<EventPreferences>) => {
      setError(null);
      try {
        const res = await authFetch(`${BASE}/api/push/subscriptions/${id}`, {
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
    [refresh],
  );

  const setPrefs = useCallback(
    async (events: Partial<EventPreferences>) => {
      if (!thisDevice) return;
      await setDevicePrefs(thisDevice.id, events);
    },
    [thisDevice, setDevicePrefs],
  );

  const setDeviceBehavior = useCallback(
    async (id: string, behavior: Partial<BehaviorPreferences>) => {
      setError(null);
      try {
        const res = await authFetch(`${BASE}/api/push/subscriptions/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ behavior }),
        });
        if (!res.ok) throw new Error(`Failed to update focus behavior (${res.status})`);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update focus behavior");
      }
    },
    [refresh],
  );

  const setBehavior = useCallback(
    async (behavior: Partial<BehaviorPreferences>) => {
      if (!thisDevice) return;
      await setDeviceBehavior(thisDevice.id, behavior);
    },
    [thisDevice, setDeviceBehavior],
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

  const refreshSubscription = useCallback(async (): Promise<void> => {
    if (support.kind !== "supported" || refreshing) return;
    setRefreshing(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration(`${BASE}/`);
      if (!reg) {
        throw new Error(
          "Service worker isn't registered yet — wait for it to activate, then try again.",
        );
      }
      await withTimeout(waitForActivation(reg), 30_000, "service worker activation");

      // Capture the current device's preferences so the new record
      // inherits them. Falls back to defaults when this is the first
      // ever subscribe (refreshSubscription should normally only be
      // called when thisDevice exists, but the UI might race).
      const previousEvents = thisDevice?.events ?? DEFAULT_PREFERENCES;
      const previousBehavior = thisDevice?.behavior ?? DEFAULT_BEHAVIOR;
      const previousId = thisDevice?.id ?? null;

      // Tear down the old subscription locally — this releases the old
      // endpoint so the browser issues a fresh one. We don't DELETE
      // the server record here: the new subscription will have a new
      // endpoint (and therefore a new device id), so the orphaned old
      // record will be left behind. It self-purges the next time the
      // server tries to deliver to it (410 → removeByEndpoint). Doing
      // it that way avoids a window where the user has neither
      // subscription on the server.
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        try {
          await existing.unsubscribe();
        } catch {
          /* best effort — `subscribe()` below will overwrite anyway */
        }
      }

      const publicKey = await fetchVapidPublicKey();
      const fresh = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(publicKey),
      });
      const json = fresh.toJSON();
      const res = await authFetch(`${BASE}/api/push/subscriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: { endpoint: fresh.endpoint, keys: json.keys },
          label: deriveLabel(),
          events: previousEvents,
          behavior: previousBehavior,
        }),
      });
      if (!res.ok) {
        throw new Error(`Failed to register refreshed subscription (${res.status})`);
      }

      // Best-effort: drop the old server record explicitly so the
      // settings UI doesn't show the orphan alongside the fresh one
      // until the next 410. Failure here is non-fatal — the orphan
      // will self-purge the next time something tries to deliver.
      if (previousId) {
        try {
          await authFetch(`${BASE}/api/push/subscriptions/${previousId}`, { method: "DELETE" });
        } catch {
          /* tolerate — orphan will 410-purge */
        }
      }

      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh subscription");
    } finally {
      setRefreshing(false);
    }
  }, [support.kind, refreshing, thisDevice, refresh]);

  const sendTest = useCallback(
    async (kind: PushEventKind = "turnComplete"): Promise<TestSendResult> => {
      setError(null);
      try {
        const res = await authFetch(`${BASE}/api/push/test?kind=${encodeURIComponent(kind)}`, {
          method: "POST",
        });
        if (!res.ok) throw new Error(`Failed to send test (${res.status})`);
        const body = (await res.json()) as TestSendResult;
        return body;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to send test notification");
        // Re-throw so the caller (settings UI) can show a user-visible
        // failure toast instead of silently appearing to succeed.
        throw err;
      }
    },
    [],
  );

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
    setDevicePrefs,
    setBehavior,
    setDeviceBehavior,
    removeDevice,
    clearAll,
    sendTest,
    refreshSubscription,
    refreshing,
    refresh,
  };
}
