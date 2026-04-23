/**
 * Module-level holder for the single ReportScheduler instance.
 *
 * server.ts creates the scheduler at boot and calls `setScheduler(...)`.
 * API routes read it via `getScheduler()`. Mirrors the pattern used by
 * session-status-store: Next.js API routes and the custom server share
 * one Node process, so a module-level singleton is reachable from both.
 */

import type { ReportScheduler } from "./scheduler";

let instance: ReportScheduler | null = null;

export function setScheduler(scheduler: ReportScheduler): void {
  instance = scheduler;
}

export function getScheduler(): ReportScheduler | null {
  return instance;
}
