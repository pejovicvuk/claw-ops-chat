/**
 * Automation rules — scheduled or trigger-driven cleanup actions that
 * keep the device stable without manual intervention.
 *
 * Distinct from `alerts/` (which fires notifications on metric breaches);
 * automations *take action* on the system (prune logs, force GC, restart
 * containers) when their condition is met.
 */

export type RuleKind =
  | "schedule_prune_docker_logs"
  | "schedule_prune_docker_images"
  | "schedule_trim_audit"
  | "schedule_trim_cache"
  | "schedule_trim_heap_snapshots"
  | "schedule_trim_monitoring_history"
  | "trigger_force_gc"
  | "trigger_drop_fs_caches"
  | "trigger_restart_unhealthy_container";

export type RuleCategory = "schedule" | "trigger";

export interface AutomationTrigger {
  /** Dotted metric path (e.g. "system.memory.usedPct"). */
  metric: string;
  operator: ">" | "<" | ">=" | "<=" | "==";
  threshold: number;
  /** Sustained duration before firing. */
  forMs: number;
}

export interface AutomationRule {
  id: string;
  name: string;
  kind: RuleKind;
  enabled: boolean;
  /** For schedule_*: cron expression (UTC). Ignored otherwise. */
  cron?: string;
  /** For trigger_*: required, ignored otherwise. */
  trigger?: AutomationTrigger;
  /** Cooldown between firings. Default 10 min. */
  cooldownMs: number;
  /** Action-specific options. */
  options: Record<string, unknown>;
  /** Optional URL to a runbook explaining what this rule does. */
  runbookUrl?: string;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  /** Last run summary (set by engine). */
  lastRun?: AutomationRunSummary;
}

export interface AutomationRunSummary {
  at: number;
  ok: boolean;
  summary: string;
  durationMs: number;
  /** Whether this was a scheduled fire, manual run-now, or trigger. */
  reason: "schedule" | "trigger" | "manual";
}

export interface AutomationRun extends AutomationRunSummary {
  id: string;
  ruleId: string;
  ruleName: string;
  kind: RuleKind;
  /** Optional structured result data. */
  details?: Record<string, unknown>;
  /** If ok=false, the error message. */
  errorMessage?: string;
}

export interface AutomationActionContext {
  rule: AutomationRule;
  reason: "schedule" | "trigger" | "manual";
  actor: string;
}

export interface AutomationActionResult {
  ok: boolean;
  summary: string;
  details?: Record<string, unknown>;
}

export type AutomationActionFn = (ctx: AutomationActionContext) => Promise<AutomationActionResult>;
