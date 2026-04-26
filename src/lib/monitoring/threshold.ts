import type { MonStatus } from "./types";

/**
 * Map raw metric values to severity buckets so the UI can color them
 * consistently. Thresholds are conservative defaults; users override
 * them via the Alerts UI.
 */

export interface ThresholdDef {
  /** Inclusive upper bound for `healthy`. */
  healthy: number;
  /** Inclusive upper bound for `warning`. Above is `critical`. */
  warning: number;
}

export function bandStatus(value: number, def: ThresholdDef): MonStatus {
  if (!Number.isFinite(value)) return "unknown";
  if (value <= def.healthy) return "healthy";
  if (value <= def.warning) return "warning";
  return "critical";
}

export const PERCENT_USAGE: ThresholdDef = { healthy: 70, warning: 85 };
export const DISK_USAGE: ThresholdDef = { healthy: 75, warning: 90 };
export const EVENT_LOOP_LAG_MS: ThresholdDef = { healthy: 50, warning: 200 };
export const ERROR_RATE_PCT: ThresholdDef = { healthy: 1, warning: 5 };
