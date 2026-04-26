import type { AlertEvent, AlertOperator, AlertRule } from "../types";

/**
 * Per-tick alert evaluator. Maintains the "above-threshold-since" timestamp
 * per rule so we only fire after sustained breach (`forMs`) and resolve
 * with hysteresis when value crosses back below threshold.
 *
 * Pure logic — no I/O. Output is the list of state transitions that
 * happened on this tick; the caller is responsible for persisting + dispatching.
 */

interface RuleState {
  /** When the value first crossed the threshold; null if not over. */
  breachStartedAt: number | null;
  /** Whether the rule is currently firing (post forMs). */
  firing: boolean;
  firingEvent: AlertEvent | null;
}

const HYSTERESIS_PCT = 0.1;

export class AlertEvaluator {
  private state = new Map<string, RuleState>();

  /**
   * Evaluate all rules against current metric values. Returns transitions
   * that occurred on this tick — the caller persists & dispatches them.
   */
  tick(
    rules: AlertRule[],
    lookup: (metric: string) => number | null,
    now = Date.now(),
  ): {
    fired: AlertEvent[];
    resolved: AlertEvent[];
  } {
    const fired: AlertEvent[] = [];
    const resolved: AlertEvent[] = [];

    const seen = new Set<string>();
    for (const rule of rules) {
      seen.add(rule.id);
      if (!rule.enabled) {
        this.state.delete(rule.id);
        continue;
      }
      if (rule.snoozedUntil && rule.snoozedUntil > now) {
        continue;
      }
      const observed = lookup(rule.metric);
      if (observed === null || !Number.isFinite(observed)) continue;
      const state = this.state.get(rule.id) ?? {
        breachStartedAt: null,
        firing: false,
        firingEvent: null,
      };
      const breached = compare(observed, rule.operator, rule.threshold);

      if (state.firing) {
        // Hysteresis: require value to cross back ± 10% of threshold to resolve.
        const stillFiring = breached || withinHysteresis(observed, rule);
        if (!stillFiring) {
          state.firing = false;
          state.breachStartedAt = null;
          if (state.firingEvent) {
            const ev: AlertEvent = {
              ...state.firingEvent,
              state: "resolved",
              resolvedAt: now,
              observedValue: observed,
            };
            resolved.push(ev);
            state.firingEvent = null;
          }
        }
      } else if (breached) {
        if (state.breachStartedAt === null) state.breachStartedAt = now;
        const dur = now - state.breachStartedAt;
        if (dur >= rule.forMs) {
          state.firing = true;
          const event: AlertEvent = {
            id: `evt_${now}_${Math.random().toString(36).slice(2, 8)}`,
            ruleId: rule.id,
            ruleName: rule.name,
            state: "firing",
            severity: rule.severity,
            firedAt: now,
            observedValue: observed,
            threshold: rule.threshold,
          };
          state.firingEvent = event;
          fired.push(event);
        }
      } else {
        state.breachStartedAt = null;
      }
      this.state.set(rule.id, state);
    }

    // Garbage-collect state for deleted rules.
    for (const id of [...this.state.keys()]) {
      if (!seen.has(id)) this.state.delete(id);
    }
    return { fired, resolved };
  }

  /** List of rules currently in the "firing" state. */
  currentFiring(): AlertEvent[] {
    const out: AlertEvent[] = [];
    for (const s of this.state.values()) {
      if (s.firing && s.firingEvent) out.push(s.firingEvent);
    }
    return out;
  }
}

function compare(value: number, op: AlertOperator, threshold: number): boolean {
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

function withinHysteresis(value: number, rule: AlertRule): boolean {
  const margin = Math.abs(rule.threshold) * HYSTERESIS_PCT;
  switch (rule.operator) {
    case ">":
    case ">=":
      return value > rule.threshold - margin;
    case "<":
    case "<=":
      return value < rule.threshold + margin;
    case "==":
      return Math.abs(value - rule.threshold) < margin;
  }
}
