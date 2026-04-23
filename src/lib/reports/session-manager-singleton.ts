/**
 * Module-level holder for the SessionManager instance created by server.ts.
 *
 * API routes can reach it via `getSessionManager()` to drive cron runs even
 * when the scheduler singleton hasn't been populated yet. Mirrors the
 * scheduler-singleton pattern and leans on Next.js + the custom server
 * sharing one Node process / one module graph.
 */

import type { CronCapableSessionManager } from "./runner";

let instance: CronCapableSessionManager | null = null;

export function setSessionManager(sm: CronCapableSessionManager): void {
  instance = sm;
  // Loud log so a missing singleton in prod is diagnosable from the container
  // stdout rather than requiring the user to debug a 503 with no context.
  console.log("> Reports SessionManager singleton registered");
}

export function getSessionManager(): CronCapableSessionManager | null {
  return instance;
}
