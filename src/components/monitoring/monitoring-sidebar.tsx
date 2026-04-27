"use client";

import {
  FiActivity,
  FiAlertCircle,
  FiBarChart2,
  FiBox,
  FiClock,
  FiCpu,
  FiFileText,
  FiHardDrive,
  FiList,
  FiServer,
  FiTool,
  FiWifi,
} from "react-icons/fi";
import type { MonStatus } from "@/lib/monitoring/types";
import { useMonContext, type MonTabKey } from "./monitoring-context";
import { StatusDot } from "./primitives/status-dot";

interface SidebarItem {
  key: MonTabKey;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}

const ITEMS: ReadonlyArray<SidebarItem> = [
  { key: "overview", label: "Overview", icon: FiActivity },
  { key: "health", label: "Server Health", icon: FiServer },
  { key: "system", label: "System", icon: FiCpu },
  { key: "processes", label: "Processes", icon: FiList },
  { key: "docker", label: "Docker", icon: FiBox },
  { key: "ws", label: "WebSockets", icon: FiWifi },
  { key: "audit", label: "Audit", icon: FiFileText },
  { key: "cron", label: "Cron / Reports", icon: FiClock },
  { key: "apm", label: "Performance", icon: FiBarChart2 },
  { key: "logs", label: "Logs & Errors", icon: FiHardDrive },
  { key: "alerts", label: "Alerts", icon: FiAlertCircle },
  { key: "automation", label: "Automation", icon: FiTool },
];

interface MonitoringSidebarProps {
  statuses: Partial<Record<MonTabKey, MonStatus>>;
  badges: Partial<Record<MonTabKey, string | number>>;
}

export function MonitoringSidebar({ statuses, badges }: MonitoringSidebarProps) {
  const { tab, setTab } = useMonContext();
  return (
    <nav
      role="tablist"
      aria-label="Monitoring sections"
      className="flex flex-row gap-1 overflow-x-auto border-b border-canvas-border bg-canvas-bg p-2 md:flex-col md:gap-0.5 md:overflow-x-visible md:overflow-y-auto md:border-b-0 md:border-r md:p-3 md:w-[200px] md:shrink-0"
    >
      {ITEMS.map((item) => {
        const active = tab === item.key;
        const Icon = item.icon;
        const status = statuses[item.key];
        const badge = badges[item.key];
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setTab(item.key)}
            className={`group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12.5px] transition-colors ${
              active
                ? "bg-canvas-surface-hover font-medium text-canvas-fg"
                : "text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
            }`}
          >
            <Icon size={14} />
            <span className="flex-1 truncate text-left">{item.label}</span>
            {badge !== undefined ? (
              <span className="rounded bg-canvas-surface px-1.5 py-0.5 text-[10px] tabular-nums text-canvas-muted">
                {badge}
              </span>
            ) : null}
            {status ? <StatusDot status={status} /> : null}
          </button>
        );
      })}
    </nav>
  );
}
