/**
 * Globally-anchored handle for the MetricsCollector singleton. Mirrors the
 * pattern used by `session-status-store.ts` and
 * `reports/scheduler-singleton.ts` — survives Next.js HMR and module-graph
 * duplication that can otherwise produce two collectors fighting for the
 * same /proc reads.
 */
import type { MetricsCollector } from "./collector";

const HANDLE = "__claw_ops_metrics_collector__";

interface GlobalThisWithCollector {
  [HANDLE]?: MetricsCollector;
}

const globalRef = globalThis as unknown as GlobalThisWithCollector;

export function setMetricsCollector(c: MetricsCollector): void {
  globalRef[HANDLE] = c;
}

export function getMetricsCollector(): MetricsCollector | null {
  return globalRef[HANDLE] ?? null;
}

export function clearMetricsCollector(): void {
  delete globalRef[HANDLE];
}
