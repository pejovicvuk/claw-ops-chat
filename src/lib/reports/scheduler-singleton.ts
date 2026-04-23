import type { ReportScheduler } from "./scheduler";

/**
 * Process-wide holder for the single ReportScheduler instance.
 *
 * Pinned to `globalThis` rather than module-local state because Next.js 16
 * standalone builds bundle API routes into a separate module graph from
 * the custom server entry point — two separate copies of this file end up
 * loaded, each with its own `let instance = null`. A plain module
 * singleton is invisible across the boundary and Run Now silently returns
 * 503 because the getter always reads the API-route copy (never set).
 *
 * `globalThis` is shared across both bundle copies since they're in one
 * Node process, so the scheduler stored by server.ts boot code is
 * reachable from the API route handlers.
 */

const KEY = "__claw_reports_scheduler_instance__";

interface Global {
  [KEY]?: ReportScheduler | null;
}

export function setScheduler(scheduler: ReportScheduler): void {
  (globalThis as Global)[KEY] = scheduler;
  // Loud log so a missing singleton is diagnosable from container stdout
  // rather than requiring the user to debug a 503 with no context.
  console.log("> Reports scheduler singleton registered (globalThis)");
}

export function getScheduler(): ReportScheduler | null {
  return (globalThis as Global)[KEY] ?? null;
}
