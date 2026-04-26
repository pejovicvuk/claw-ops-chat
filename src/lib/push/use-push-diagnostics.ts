"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/auth";
import type { PushEventKind } from "./types";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

export interface DiagnosticsEntry {
  ts: number;
  email: string;
  device: string;
  kind: PushEventKind;
  outcome: "sent" | "dropped" | "error";
  detail?: string;
}

interface DiagnosticsResponse {
  entries: DiagnosticsEntry[];
}

/**
 * Reads the server's recent push delivery log. Used by the settings
 * "Recent deliveries" panel; refresh is manual (no polling) so the
 * panel doesn't generate background load when the user isn't looking.
 */
export function usePushDiagnostics(): {
  entries: DiagnosticsEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [entries, setEntries] = useState<DiagnosticsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${BASE}/api/push/diagnostics`);
      if (!res.ok) throw new Error(`Failed to load diagnostics (${res.status})`);
      const body = (await res.json()) as DiagnosticsResponse;
      setEntries(body.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load diagnostics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { entries, loading, error, refresh };
}
