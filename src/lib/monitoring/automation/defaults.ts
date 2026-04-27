import type { AutomationRule, RuleKind } from "./types";

/**
 * Default automation rules pre-installed on first boot. These are
 * conservative — three are enabled out of the box (all non-destructive),
 * the rest are disabled and surfaced for the operator to toggle on.
 *
 * The cron expressions are UTC; pick off-hours so cleanups don't compete
 * with peak traffic.
 */

const TEN_MIN_MS = 10 * 60 * 1000;

interface SeedRule {
  name: string;
  kind: RuleKind;
  enabled: boolean;
  cron?: string;
  trigger?: AutomationRule["trigger"];
  options: Record<string, unknown>;
  cooldownMs?: number;
  runbookUrl?: string;
}

export const DEFAULT_RULES: SeedRule[] = [
  {
    name: "Prune Docker container logs (weekly)",
    kind: "schedule_prune_docker_logs",
    enabled: false, // requires :rw socket; opt-in
    cron: "0 3 * * 0", // Sundays 03:00 UTC
    options: {
      maxBytes: 50 * 1024 * 1024, // 50 MB per container log
      tailLines: 10000,
    },
  },
  {
    name: "Prune dangling Docker images (weekly)",
    kind: "schedule_prune_docker_images",
    enabled: false, // destructive; opt-in
    cron: "30 3 * * 0",
    options: {
      olderThanHours: 168, // 7 days
    },
  },
  {
    name: "Tighten audit-log retention (daily)",
    kind: "schedule_trim_audit",
    enabled: true,
    cron: "0 4 * * *", // Daily 04:00 UTC
    options: {
      maxAgeDays: 30,
    },
  },
  {
    name: "Trim preview / proxy cache (daily)",
    kind: "schedule_trim_cache",
    enabled: true,
    cron: "30 4 * * *",
    options: {},
  },
  {
    name: "Trim heap snapshots (weekly)",
    kind: "schedule_trim_heap_snapshots",
    enabled: true,
    cron: "0 5 * * 0",
    options: {
      maxAgeDays: 14,
    },
  },
  {
    name: "Trim long-term metrics history (daily)",
    kind: "schedule_trim_monitoring_history",
    enabled: true,
    cron: "0 5 * * *",
    options: {
      maxAgeDays: 7,
    },
  },
  {
    name: "Auto Force-GC on heap pressure",
    kind: "trigger_force_gc",
    enabled: true,
    trigger: {
      metric: "health.memory.heapUsedPct",
      operator: ">",
      threshold: 90,
      forMs: 2 * 60 * 1000, // 2 min sustained
    },
    cooldownMs: TEN_MIN_MS,
    options: {},
  },
  {
    name: "Drop kernel FS caches on memory pressure",
    kind: "trigger_drop_fs_caches",
    enabled: false, // touches host kernel state; advanced
    trigger: {
      metric: "system.memory.usedPct",
      operator: ">",
      threshold: 92,
      forMs: 5 * 60 * 1000,
    },
    cooldownMs: 30 * 60 * 1000, // 30 min
    options: {},
  },
  {
    name: "Restart unhealthy Docker containers",
    kind: "trigger_restart_unhealthy_container",
    enabled: false, // disruptive; opt-in
    trigger: {
      metric: "docker.unhealthyCount",
      operator: ">",
      threshold: 0,
      forMs: 5 * 60 * 1000,
    },
    cooldownMs: 15 * 60 * 1000,
    options: {},
  },
];

export function instantiateDefault(seed: SeedRule, now: number): AutomationRule {
  return {
    id: `rule_default_${seed.kind}`,
    name: seed.name,
    kind: seed.kind,
    enabled: seed.enabled,
    cron: seed.cron,
    trigger: seed.trigger,
    cooldownMs: seed.cooldownMs ?? TEN_MIN_MS,
    options: seed.options,
    runbookUrl: seed.runbookUrl,
    createdAt: now,
    updatedAt: now,
    createdBy: "system",
  };
}
