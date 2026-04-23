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
  // Loud log so a missing singleton in prod is diagnosable from the
  // container stdout rather than requiring the user to debug a 503 with
  // no context. Bootstrap() logs its own "N jobs loaded" once finished.
  console.log("> Reports scheduler singleton registered");
}

export function getScheduler(): ReportScheduler | null {
  return instance;
}
