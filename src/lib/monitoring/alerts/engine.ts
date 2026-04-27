import { listRules } from "./store";
import { AlertEvaluator } from "./evaluator";
import { AlertDispatcher } from "./dispatcher";
import { metricLookup } from "./metric-lookup";
import { auditCountLookup } from "./audit-count-lookup";
import { isInMaintenanceWindow } from "../maintenance/store";
import { getMetricsCollector } from "../singleton";
import type { AlertEvent, AlertRule } from "../types";

const TICK_MS = 5_000;
const HISTORY_SIZE = 100;

export class AlertEngine {
  private timer: NodeJS.Timeout | null = null;
  private readonly evaluator = new AlertEvaluator();
  private readonly dispatcher: AlertDispatcher;
  /** Recent alert events, newest first. */
  private history: AlertEvent[] = [];

  constructor() {
    this.dispatcher = new AlertDispatcher();
  }

  start(): void {
    if (this.timer) return;
    const tick = async () => {
      try {
        const collector = getMetricsCollector();
        if (!collector) return;
        const allRules = await listRules();
        // Filter out rules currently in a maintenance window — they
        // skip evaluation entirely, mirroring snoozedUntil semantics.
        const ruleIsActive = await Promise.all(
          allRules.map((r) => isInMaintenanceWindow(r.id).then((m) => !m)),
        );
        const activeRules = allRules.filter((_, i) => ruleIsActive[i]);
        const baseLookup = metricLookup(collector);
        const auditLookup = auditCountLookup();
        const lookup = (path: string) => {
          if (path.startsWith("audit.count(")) return auditLookup(path);
          return baseLookup(path);
        };
        const transitions = this.evaluator.tick(activeRules, lookup);
        if (transitions.fired.length > 0 || transitions.resolved.length > 0) {
          this.history.unshift(...transitions.fired, ...transitions.resolved);
          if (this.history.length > HISTORY_SIZE) {
            this.history.length = HISTORY_SIZE;
          }
          // Look up the rule for each transition (events carry id only).
          const ruleById = new Map<string, AlertRule>(allRules.map((r) => [r.id, r]));
          const envelopes = [...transitions.fired, ...transitions.resolved]
            .map((event) => {
              const rule = ruleById.get(event.ruleId);
              if (!rule) return null;
              return { event, rule };
            })
            .filter((e): e is { event: AlertEvent; rule: AlertRule } => e !== null);
          await this.dispatcher.dispatch(envelopes);
        }
      } catch (err) {
        console.warn(
          "[monitoring/alerts] tick failed:",
          err instanceof Error ? err.message : String(err),
        );
      }
    };
    this.timer = setInterval(tick, TICK_MS);
    this.timer.unref?.();
    void tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  currentlyFiring(): AlertEvent[] {
    return this.evaluator.currentFiring();
  }

  recentHistory(limit = 50): AlertEvent[] {
    return this.history.slice(0, limit);
  }
}

let _instance: AlertEngine | null = null;
export function getAlertEngine(): AlertEngine {
  if (!_instance) _instance = new AlertEngine();
  return _instance;
}
