"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

export interface Unfurl {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
  favicon: string | null;
}

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: Unfurl }
  | { status: "error"; message: string };

/**
 * Session-scoped in-memory cache so every LinkPreview in a long
 * conversation doesn't re-hit the unfurl endpoint on scroll-back.
 * (The server already disk-caches, so this just saves a fetch.)
 */
const memoryCache = new Map<string, Unfurl | null>();
const inFlight = new Map<string, Promise<Unfurl | null>>();

async function fetchUnfurl(href: string): Promise<Unfurl | null> {
  if (memoryCache.has(href)) return memoryCache.get(href) ?? null;
  const existing = inFlight.get(href);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const res = await authFetch(`${BASE}/api/proxy/unfurl?url=${encodeURIComponent(href)}`);
      if (!res.ok) {
        memoryCache.set(href, null);
        return null;
      }
      const data = (await res.json()) as Unfurl;
      memoryCache.set(href, data);
      return data;
    } catch {
      memoryCache.set(href, null);
      return null;
    } finally {
      inFlight.delete(href);
    }
  })();
  inFlight.set(href, promise);
  return promise;
}

/**
 * Hook: lazy-fetch an unfurl. Debounces 250ms so a URL being streamed
 * into a message doesn't kick off a fetch for every character.
 */
export function useUnfurl(href: string | undefined, enabled = true): State {
  const [state, setState] = useState<State>({ status: "idle" });

  useEffect(() => {
    if (!enabled || !href) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    const timer = setTimeout(() => {
      fetchUnfurl(href).then((data) => {
        if (cancelled) return;
        if (data) setState({ status: "ok", data });
        else setState({ status: "error", message: "unfurl failed" });
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [href, enabled]);

  return state;
}
