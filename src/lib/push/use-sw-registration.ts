"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Module-level service-worker registration. The previous inline
 * `<script>` in layout.tsx swallowed errors; this hook tracks state so
 * the settings UI can surface "service worker active" / "redundant —
 * hard reload" instead of silently breaking push.
 *
 * One global registration is enough: the app is single-page under /chat,
 * and re-registering on every mount would race with the natural
 * activation lifecycle.
 */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

export type SwRegistrationStatus =
  | "idle"
  | "unsupported"
  | "installing"
  | "active"
  | "redundant"
  | "failed";

export interface SwRegistrationState {
  status: SwRegistrationStatus;
  error: string | null;
  /** Whether a registration attempt is in flight. */
  registering: boolean;
}

let state: SwRegistrationState = { status: "idle", error: null, registering: false };
let started = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

function setState(patch: Partial<SwRegistrationState>): void {
  state = { ...state, ...patch };
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): SwRegistrationState {
  return state;
}

function getServerSnapshot(): SwRegistrationState {
  return { status: "idle", error: null, registering: false };
}

function trackWorker(worker: ServiceWorker): void {
  const update = () => {
    if (worker.state === "activated") {
      setState({ status: "active", error: null });
    } else if (worker.state === "redundant") {
      setState({
        status: "redundant",
        error: "Service worker became redundant — try a hard reload to recover push.",
      });
    } else if (worker.state === "installing" || worker.state === "installed") {
      setState({ status: "installing" });
    }
  };
  update();
  worker.addEventListener("statechange", update);
}

async function registerOnce(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) {
    setState({ status: "unsupported", registering: false });
    return;
  }
  setState({ registering: true, error: null });
  try {
    const reg = await navigator.serviceWorker.register(`${BASE}/sw.js`, { scope: `${BASE}/` });
    if (reg.active) {
      setState({ status: "active", registering: false });
    } else {
      setState({ status: "installing", registering: false });
    }
    const target = reg.installing ?? reg.waiting ?? reg.active;
    if (target) trackWorker(target);
    reg.addEventListener("updatefound", () => {
      const fresh = reg.installing;
      if (fresh) trackWorker(fresh);
    });
  } catch (err) {
    setState({
      status: "failed",
      error: err instanceof Error ? err.message : "Service worker registration failed",
      registering: false,
    });
  }
}

/**
 * Mount once at the app root. Idempotent — safe under React StrictMode
 * double-invoke and HMR re-mounts.
 */
export function useRegisterServiceWorker(): SwRegistrationState {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    if (started) return;
    started = true;
    void registerOnce();
  }, []);
  return snapshot;
}

/** Read-only consumer (e.g. settings status row). Doesn't trigger registration. */
export function useSwRegistrationStatus(): SwRegistrationState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
