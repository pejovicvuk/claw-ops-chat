"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth";
import type { AuditEvent, AuditEventPage, AuditFilter, AuditStats } from "@/lib/audit/types";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

function buildQuery(filter: AuditFilter, cursor?: string): string {
  const params = new URLSearchParams();
  if (filter.category && filter.category.length > 0)
    params.set("category", filter.category.join(","));
  if (filter.severity && filter.severity.length > 0)
    params.set("severity", filter.severity.join(","));
  if (typeof filter.from === "number") params.set("from", String(filter.from));
  if (typeof filter.to === "number") params.set("to", String(filter.to));
  if (filter.q) params.set("q", filter.q);
  if (typeof filter.limit === "number") params.set("limit", String(filter.limit));
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

export interface UseAuditEventsReturn {
  events: AuditEvent[];
  loadMore: () => void;
  hasMore: boolean;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

export function useAuditEvents(filter: AuditFilter): UseAuditEventsReturn {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // Track the filter that's currently loaded so resets are predictable.
  const loadingRef = useRef(false);
  const lastFilterKey = useRef<string>("");

  const filterKey = JSON.stringify(filter);

  const fetchPage = useCallback(
    async (nextCursor: string | null, replace: boolean) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const qs = buildQuery(filter, nextCursor ?? undefined);
        const res = await authFetch(`${BASE}/api/audit/events?${qs}`);
        if (!res.ok) throw new Error(`Audit fetch failed: ${res.status}`);
        const page = (await res.json()) as AuditEventPage;
        setEvents((prev) => (replace ? page.events : [...prev, ...page.events]));
        setCursor(page.nextCursor);
        setHasMore(page.nextCursor !== null);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setLoading(false);
        loadingRef.current = false;
      }
    },
    [filter],
  );

  useEffect(() => {
    // Reset + refetch whenever the filter changes.
    if (lastFilterKey.current !== filterKey) {
      lastFilterKey.current = filterKey;
      setEvents([]);
      setCursor(null);
      setHasMore(true);
      void fetchPage(null, true);
    }
  }, [filterKey, fetchPage]);

  const loadMore = useCallback(() => {
    if (!hasMore || loadingRef.current) return;
    void fetchPage(cursor, false);
  }, [hasMore, cursor, fetchPage]);

  const refresh = useCallback(() => {
    setEvents([]);
    setCursor(null);
    setHasMore(true);
    void fetchPage(null, true);
  }, [fetchPage]);

  return { events, loadMore, hasMore, loading, error, refresh };
}

export function useAuditStats(): {
  stats: AuditStats | null;
  refetch: () => void;
  loading: boolean;
} {
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${BASE}/api/audit/stats`);
      if (!res.ok) return;
      const data = (await res.json()) as AuditStats;
      setStats(data);
    } catch {
      /* tolerate transient failures */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { stats, refetch, loading };
}

/** POST-like helper for the "purge" action. Returns freed bytes + deleted file names. */
export async function purgeAuditEvents(opts: {
  category?: "api" | "cron" | "session" | "alert";
  olderThan?: number;
}): Promise<{ deleted: string[]; bytesFreed: number }> {
  const params = new URLSearchParams();
  if (opts.category) params.set("category", opts.category);
  if (typeof opts.olderThan === "number") params.set("olderThan", String(opts.olderThan));
  const url = `${BASE}/api/audit/events${params.toString() ? `?${params.toString()}` : ""}`;
  const res = await authFetch(url, { method: "DELETE" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Purge failed: ${res.status}`);
  }
  return res.json();
}

/** Trigger a browser download of the export NDJSON file. */
export function exportAuditEvents(filter: AuditFilter): void {
  const qs = buildQuery({ ...filter, limit: undefined });
  const url = `${BASE}/api/audit/export${qs ? `?${qs}` : ""}`;
  // authFetch retries 401 via cookie refresh; we need the same for the
  // download, so fetch blob -> anchor click rather than a plain href.
  void (async () => {
    try {
      const res = await authFetch(url);
      if (!res.ok) return;
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `audit-${new Date().toISOString().slice(0, 10)}.jsonl`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
    } catch {
      /* silent — UI shows no notifier on download error for now */
    }
  })();
}
