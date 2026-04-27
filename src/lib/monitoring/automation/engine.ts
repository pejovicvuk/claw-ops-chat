import cron, { type ScheduledTask } from "node-cron";
import { getAuditWriter } from "../../audit/writer";
import { metricLookup } from "../alerts/metric-lookup";
import { getMetricsCollector } from "../singleton";
import { ACTIONS } from "./actions";
import { ensureDefaults, listRules, appendRun, updateRule } from "./store";
import type { AutomationActionContext, AutomationRule, AutomationRun, RuleKind } from "./types";

const TRIGGER_TICK_MS = 10_000;
const RUN_HISTORY_LIMIT = 200;

interface TriggerState {
  /** When the trigger condition first became true. */
  breachStartedAt: number | null;
  /** When the action last fired (for cooldown). */
  lastFiredAt: number | null;
}

/**
 * Singleton engine: registers cron tasks for `schedule_*` rules, ticks
 * trigger rules every 10s with sustained-breach + cooldown logic. Each
 * fire writes an audit entry and an `AutomationRun` to the JSONL log.
 */
export class AutomationEngine {
  private cronTasks = new Map<string, ScheduledTask>();
  private triggerStates = new Map<string, TriggerState>();
  private triggerTimer: NodeJS.Timeout | null = null;
  private started = false;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // Seed defaults if the store is empty (first boot).
    try {
      const seeded = await ensureDefaults();
      if (seeded.added > 0) {
        console.log(`> Automation: seeded ${seeded.added} default rule(s)`);
      }
    } catch (err) {
      console.warn(
        `[automation] seed-defaults failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    await this.reconcileRules();
    this.triggerTimer = setInterval(() => {
      this.tickTriggers().catch((err) => {
        console.warn(
          `[automation] trigger tick failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, TRIGGER_TICK_MS);
    this.triggerTimer.unref?.();
  }

  stop(): void {
    for (const t of this.cronTasks.values()) t.stop();
    this.cronTasks.clear();
    this.triggerStates.clear();
    if (this.triggerTimer) {
      clearInterval(this.triggerTimer);
      this.triggerTimer = null;
    }
    this.started = false;
  }

  /**
   * Pulls the latest rule list from disk and re-syncs cron task
   * registrations. Trigger rules are evaluated lazily on the trigger
   * tick. Call after CRUD mutations.
   */
  async reconcileRules(): Promise<void> {
    const rules = await listRules();
    const seen = new Set<string>();
    for (const rule of rules) {
      seen.add(rule.id);
      if (rule.kind.startsWith("schedule_") && rule.enabled && rule.cron) {
        // (Re)register if cron expression changed.
        const existing = this.cronTasks.get(rule.id);
        if (existing) existing.stop();
        if (!cron.validate(rule.cron)) {
          console.warn(`[automation] rule ${rule.id} has invalid cron expression: ${rule.cron}`);
          continue;
        }
        const task = cron.schedule(
          rule.cron,
          () => {
            void this.runRule(rule.id, "schedule", "system");
          },
          { timezone: "UTC" },
        );
        this.cronTasks.set(rule.id, task);
      } else {
        const existing = this.cronTasks.get(rule.id);
        if (existing) {
          existing.stop();
          this.cronTasks.delete(rule.id);
        }
      }
    }
    for (const id of [...this.cronTasks.keys()]) {
      if (!seen.has(id)) {
        this.cronTasks.get(id)?.stop();
        this.cronTasks.delete(id);
      }
    }
    for (const id of [...this.triggerStates.keys()]) {
      if (!seen.has(id)) this.triggerStates.delete(id);
    }
  }

  /** Manual run-now from API. */
  async runNow(id: string, actor: string): Promise<AutomationRun | { error: string }> {
    const rules = await listRules();
    const rule = rules.find((r) => r.id === id);
    if (!rule) return { error: "Rule not found" };
    return this.execute(rule, "manual", actor);
  }

  private async runRule(
    id: string,
    reason: "schedule" | "trigger" | "manual",
    actor: string,
  ): Promise<void> {
    const rules = await listRules();
    const rule = rules.find((r) => r.id === id);
    if (!rule || !rule.enabled) return;
    await this.execute(rule, reason, actor);
  }

  private async execute(
    rule: AutomationRule,
    reason: "schedule" | "trigger" | "manual",
    actor: string,
  ): Promise<AutomationRun> {
    const action = ACTIONS[rule.kind];
    const startedAt = Date.now();
    let ok = false;
    let summary = "Unknown action";
    let details: Record<string, unknown> | undefined;
    let errorMessage: string | undefined;
    try {
      const ctx: AutomationActionContext = { rule, reason, actor };
      const result = await action(ctx);
      ok = result.ok;
      summary = result.summary;
      details = result.details;
    } catch (err) {
      ok = false;
      summary = err instanceof Error ? err.message : String(err);
      errorMessage = summary;
    }
    const finishedAt = Date.now();
    const run: AutomationRun = {
      id: `run_${finishedAt}_${Math.random().toString(36).slice(2, 8)}`,
      ruleId: rule.id,
      ruleName: rule.name,
      kind: rule.kind,
      ok,
      summary,
      durationMs: finishedAt - startedAt,
      reason,
      at: finishedAt,
      details,
      errorMessage,
    };
    await appendRun(run).catch(() => {});
    await updateRule(rule.id, {
      lastRun: { at: run.at, ok, summary, durationMs: run.durationMs, reason },
    }).catch(() => {});
    await this.audit(run);

    if (reason === "trigger") {
      const state = this.triggerStates.get(rule.id) ?? {
        breachStartedAt: null,
        lastFiredAt: null,
      };
      state.lastFiredAt = finishedAt;
      this.triggerStates.set(rule.id, state);
    }
    return run;
  }

  private async tickTriggers(): Promise<void> {
    const collector = getMetricsCollector();
    if (!collector) return;
    const rules = await listRules();
    const lookup = metricLookup(collector);
    const now = Date.now();
    for (const rule of rules) {
      if (!rule.kind.startsWith("trigger_") || !rule.enabled || !rule.trigger) continue;
      const state = this.triggerStates.get(rule.id) ?? {
        breachStartedAt: null,
        lastFiredAt: null,
      };
      // Cooldown.
      if (state.lastFiredAt && now - state.lastFiredAt < rule.cooldownMs) {
        this.triggerStates.set(rule.id, state);
        continue;
      }
      const observed = lookup(rule.trigger.metric);
      if (observed === null || !Number.isFinite(observed)) {
        state.breachStartedAt = null;
        this.triggerStates.set(rule.id, state);
        continue;
      }
      const breached = compare(observed, rule.trigger.operator, rule.trigger.threshold);
      if (breached) {
        if (state.breachStartedAt === null) state.breachStartedAt = now;
        if (now - state.breachStartedAt >= rule.trigger.forMs) {
          state.breachStartedAt = null;
          this.triggerStates.set(rule.id, state);
          await this.execute(rule, "trigger", "system").catch(() => {});
          continue;
        }
      } else {
        state.breachStartedAt = null;
      }
      this.triggerStates.set(rule.id, state);
    }
  }

  private async audit(run: AutomationRun): Promise<void> {
    await getAuditWriter()
      .alert({
        type: run.ok ? "alert_resolved" : "alert_fired",
        severity: run.ok ? "info" : "warn",
        actor: "system",
        subject: `automation.${run.kind}: ${run.summary}`,
        durationMs: run.durationMs,
        ruleId: run.ruleId,
        ruleName: run.ruleName,
        details: { reason: run.reason, kind: run.kind, ok: run.ok, summary: run.summary },
      })
      .catch(() => {});
  }
}

function compare(value: number, op: ">" | "<" | ">=" | "<=" | "==", threshold: number): boolean {
  switch (op) {
    case ">":
      return value > threshold;
    case "<":
      return value < threshold;
    case ">=":
      return value >= threshold;
    case "<=":
      return value <= threshold;
    case "==":
      return value === threshold;
  }
}

let _instance: AutomationEngine | null = null;
export function getAutomationEngine(): AutomationEngine {
  if (!_instance) _instance = new AutomationEngine();
  return _instance;
}

// Suppress lint for the unused-locals warning on RUN_HISTORY_LIMIT (kept as guidance).
void RUN_HISTORY_LIMIT;
// Suppress unused export for kind type alias (used by callers).
export type { RuleKind };
