import { listRules } from "./store";
import { AlertEvaluator } from "./evaluator";
import { AlertDispatcher, WebPushChannel } from "./dispatcher";
import { metricLookup } from "./metric-lookup";
import { getMetricsCollector } from "../singleton";
import type { AlertEvent } from "../types";

const TICK_MS = 5_000;
const HISTORY_SIZE = 100;

export class AlertEngine {
  private timer: NodeJS.Timeout | null = null;
  private readonly evaluator = new AlertEvaluator();
  private readonly dispatcher: AlertDispatcher;
  /** Recent alert events, newest first. */
  private history: AlertEvent[] = [];

  constructor() {
    this.dispatcher = new AlertDispatcher([new WebPushChannel()]);
  }

  start(): void {
    if (this.timer) return;
    const tick = async () => {
      try {
        const collector = getMetricsCollector();
        if (!collector) return;
        const rules = await listRules();
        const lookup = metricLookup(collector);
        const transitions = this.evaluator.tick(rules, lookup);
        if (transitions.fired.length > 0 || transitions.resolved.length > 0) {
          this.history.unshift(...transitions.fired, ...transitions.resolved);
          if (this.history.length > HISTORY_SIZE) {
            this.history.length = HISTORY_SIZE;
          }
          await this.dispatcher.dispatch(transitions);
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
