"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useUrlState } from "@/lib/use-url-state";

export type MonRefreshOption = "2s" | "5s" | "10s" | "30s" | "off";
export type MonRangeOption = "5m" | "15m" | "1h" | "6h" | "24h";
export type MonTabKey =
  | "overview"
  | "health"
  | "system"
  | "processes"
  | "docker"
  | "ws"
  | "audit"
  | "cron"
  | "apm"
  | "logs"
  | "alerts"
  | "automation";

const REFRESH_TO_MS: Record<MonRefreshOption, number | null> = {
  "2s": 2000,
  "5s": 5000,
  "10s": 10_000,
  "30s": 30_000,
  off: null,
};

interface MonContextValue {
  tab: MonTabKey;
  setTab: (t: MonTabKey) => void;
  range: MonRangeOption;
  setRange: (r: MonRangeOption) => void;
  refresh: MonRefreshOption;
  setRefresh: (r: MonRefreshOption) => void;
  refreshMs: number | null;
  paused: boolean;
  setPaused: (p: boolean) => void;
  panel: string | null;
  setPanel: (p: string | null) => void;
  subTab: string | null;
  setSubTab: (s: string | null) => void;
}

const MonContext = createContext<MonContextValue | null>(null);

const VALID_TABS: MonTabKey[] = [
  "overview",
  "health",
  "system",
  "processes",
  "docker",
  "ws",
  "audit",
  "cron",
  "apm",
  "logs",
  "alerts",
  "automation",
];

const VALID_REFRESH: MonRefreshOption[] = ["2s", "5s", "10s", "30s", "off"];
const VALID_RANGES: MonRangeOption[] = ["5m", "15m", "1h", "6h", "24h"];

export function MonitoringProvider({ children }: { children: ReactNode }) {
  const { params, setParam } = useUrlState();
  const tab = parseEnum<MonTabKey>(params.get("monTab"), VALID_TABS, "overview");
  const range = parseEnum<MonRangeOption>(params.get("monRange"), VALID_RANGES, "1h");
  const refresh = parseEnum<MonRefreshOption>(params.get("monRefresh"), VALID_REFRESH, "5s");
  const panel = params.get("monPanel");
  const subTab = params.get("monSubTab");
  const [paused, setPaused] = useState(false);

  const setTab = useCallback(
    (t: MonTabKey) => {
      setParam("monTab", t);
      setParam("monPanel", null);
      setParam("monSubTab", null);
    },
    [setParam],
  );
  const setRange = useCallback((r: MonRangeOption) => setParam("monRange", r), [setParam]);
  const setRefresh = useCallback((r: MonRefreshOption) => setParam("monRefresh", r), [setParam]);
  const setPanel = useCallback((p: string | null) => setParam("monPanel", p), [setParam]);
  const setSubTab = useCallback((s: string | null) => setParam("monSubTab", s), [setParam]);

  const value = useMemo<MonContextValue>(
    () => ({
      tab,
      setTab,
      range,
      setRange,
      refresh,
      setRefresh,
      refreshMs: REFRESH_TO_MS[refresh],
      paused,
      setPaused,
      panel,
      setPanel,
      subTab,
      setSubTab,
    }),
    [tab, setTab, range, setRange, refresh, setRefresh, paused, panel, setPanel, subTab, setSubTab],
  );

  return <MonContext.Provider value={value}>{children}</MonContext.Provider>;
}

export function useMonContext(): MonContextValue {
  const ctx = useContext(MonContext);
  if (!ctx) throw new Error("useMonContext outside of MonitoringProvider");
  return ctx;
}

function parseEnum<T extends string>(value: string | null, valid: readonly T[], fallback: T): T {
  if (value && (valid as readonly string[]).includes(value)) return value as T;
  return fallback;
}
