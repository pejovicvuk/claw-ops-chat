"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

export interface FileStat {
  exists: boolean;
  size: number;
  /** ms epoch */
  mtime: number;
  mime: string;
}

const memoryCache = new Map<string, FileStat | null>();
const inFlight = new Map<string, Promise<FileStat | null>>();

async function fetchStat(path: string): Promise<FileStat | null> {
  if (memoryCache.has(path)) return memoryCache.get(path) ?? null;
  const existing = inFlight.get(path);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const res = await authFetch(`${BASE}/api/files/stat?path=${encodeURIComponent(path)}`);
      if (!res.ok) {
        memoryCache.set(path, null);
        return null;
      }
      const data = (await res.json()) as FileStat;
      memoryCache.set(path, data);
      return data;
    } catch {
      memoryCache.set(path, null);
      return null;
    } finally {
      inFlight.delete(path);
    }
  })();
  inFlight.set(path, promise);
  return promise;
}

/**
 * Hook: lazy-fetch { size, mtime, mime } for a local file path.
 * Debounced 100 ms so cards that mount/unmount during fast scroll
 * don't fire the stat call.
 */
export function useFileStat(path: string): { stat: FileStat | null; loading: boolean } {
  const [state, setState] = useState<{ stat: FileStat | null; loading: boolean }>({
    stat: memoryCache.get(path) ?? null,
    loading: !memoryCache.has(path),
  });

  useEffect(() => {
    // Hot-cache path: just skip. Initial state already matches.
    if (memoryCache.has(path)) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchStat(path).then((data) => {
        if (cancelled) return;
        setState({ stat: data, loading: false });
      });
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [path]);

  return state;
}
