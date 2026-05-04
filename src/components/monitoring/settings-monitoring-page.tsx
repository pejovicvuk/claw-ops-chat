"use client";

import { useMonPoll } from "@/lib/monitoring/use-mon-poll";
import type { MonStatus, OverviewSnapshot } from "@/lib/monitoring/types";
import { MonitoringProvider, useMonContext, type MonTabKey } from "./monitoring-context";
import { MonitoringSidebar } from "./monitoring-sidebar";
import { MonitoringToolbar } from "./monitoring-toolbar";
import { OverviewSection } from "./sections/overview-section";
import { HealthSection } from "./sections/health-section";
import { SystemSection } from "./sections/system-section";
import { ProcessesSection } from "./sections/processes-section";
import { DockerSection } from "./sections/docker-section";
import { WsSection } from "./sections/ws-section";
import { PreviewsSection } from "./sections/previews-section";
import { AuditLiveSection } from "./sections/audit-live-section";
import { CronSection } from "./sections/cron-section";
import { ApmSection } from "./sections/apm-section";
import { LogsSection } from "./sections/logs-section";
import { AlertsSection } from "./sections/alerts-section";
import { AutomationSection } from "./sections/automation-section";

export function SettingsMonitoringPage() {
  return (
    <MonitoringProvider>
      <MonitoringPageInner />
    </MonitoringProvider>
  );
}

function MonitoringPageInner() {
  const { tab, refreshMs, paused } = useMonContext();
  const overviewQuery = useMonPoll<OverviewSnapshot>("/api/monitoring/overview", {
    intervalMs: refreshMs,
    paused,
  });

  const statuses: Partial<Record<MonTabKey, MonStatus>> = {};
  const badges: Partial<Record<MonTabKey, string | number>> = {};
  if (overviewQuery.data) {
    for (const sub of overviewQuery.data.subsystems) {
      statuses[sub.key as MonTabKey] = sub.status;
      if (sub.badge) badges[sub.key as MonTabKey] = sub.badge;
    }
  }

  return (
    <div className="flex h-full min-h-[600px] flex-col md:flex-row">
      <MonitoringSidebar statuses={statuses} badges={badges} />
      <div className="flex min-h-0 flex-1 flex-col">
        <MonitoringToolbar />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "overview" && <OverviewSection />}
          {tab === "health" && <HealthSection />}
          {tab === "system" && <SystemSection />}
          {tab === "processes" && <ProcessesSection />}
          {tab === "docker" && <DockerSection />}
          {tab === "ws" && <WsSection />}
          {tab === "previews" && <PreviewsSection />}
          {tab === "audit" && <AuditLiveSection />}
          {tab === "cron" && <CronSection />}
          {tab === "apm" && <ApmSection />}
          {tab === "logs" && <LogsSection />}
          {tab === "alerts" && <AlertsSection />}
          {tab === "automation" && <AutomationSection />}
        </div>
      </div>
    </div>
  );
}
