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
type SettledResult = { status: "ok"; data: Unfurl } | { status: "error"; message: string };

export function useUnfurl(href: string | undefined, enabled = true): State {
  // Results keyed by href. A missing entry means "still loading"; an
  // absent or disabled hook is derived synchronously below as "idle".
  // Storing async results in a per-href map (instead of a single State
  // slot the effect kept rewriting to "loading") satisfies React 19's
  // `react-hooks/set-state-in-effect` rule — setState now only happens
  // inside the async then() callback, which is the rule's allowed
  // "subscribe-style" pattern.
  const [results, setResults] = useState<Map<string, SettledResult>>(() => new Map());

  useEffect(() => {
    if (!enabled || !href) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchUnfurl(href).then((data) => {
        if (cancelled) return;
        setResults((prev) => {
          const next = new Map(prev);
          next.set(
            href,
            data ? { status: "ok", data } : { status: "error", message: "unfurl failed" },
          );
          return next;
        });
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [href, enabled]);

  if (!enabled || !href) return { status: "idle" };
  return results.get(href) ?? { status: "loading" };
}
