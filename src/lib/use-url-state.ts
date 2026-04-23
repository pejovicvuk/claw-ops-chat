"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * URL search-param state sync without triggering Next.js re-renders.
 *
 * - Reads are via `useSyncExternalStore` on `window.location.search`
 *   (subscribes to `popstate` so back/forward buttons work).
 * - Writes use `window.history.replaceState` — no app navigation, no
 *   component re-mounts, just a URL update.
 *
 * Use this for ephemeral UI state (selected tab, open panels, current folder)
 * that should survive refresh + be shareable via URL.
 */

function getSearch(): string {
  if (typeof window === "undefined") return "";
  return window.location.search;
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  listeners.add(cb);
  const onPopState = () => listeners.forEach((l) => l());
  window.addEventListener("popstate", onPopState);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("popstate", onPopState);
  };
}

export function useUrlState() {
  const search = useSyncExternalStore(
    subscribe,
    getSearch,
    () => "", // server snapshot (no search params during SSR)
  );

  const params = new URLSearchParams(search);

  const setParam = useCallback((key: string, value: string | null) => {
    if (typeof window === "undefined") return;
    const next = new URLSearchParams(window.location.search);
    if (value === null || value === "") {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    const qs = next.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", url);
    // Notify local listeners (popstate doesn't fire for replaceState).
    listeners.forEach((l) => l());
  }, []);

  /**
   * Replace every value of a repeated key. Used for ordered lists that need
   * to survive refresh (e.g. `?open=a&open=b&open=c`). Passing an empty
   * array removes the key entirely.
   */
  const setParamMulti = useCallback((key: string, values: string[]) => {
    if (typeof window === "undefined") return;
    const next = new URLSearchParams(window.location.search);
    next.delete(key);
    for (const v of values) {
      if (v) next.append(key, v);
    }
    const qs = next.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", url);
    listeners.forEach((l) => l());
  }, []);

  return { params, setParam, setParamMulti };
}
