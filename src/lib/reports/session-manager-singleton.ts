import type { CronCapableSessionManager } from "./runner";

/**
 * Process-wide holder for the SessionManager instance created by server.ts.
 *
 * Pinned to `globalThis` for the same reason as scheduler-singleton:
 * Next.js 16 standalone builds duplicate this module between the custom
 * server entry and the bundled API routes, so a plain module-local
 * singleton is never visible to the API routes. This was the root cause
 * of the "Run Now" 503s — both this module AND scheduler-singleton
 * returned null in the API-route bundle because `setSessionManager` fired
 * in server.ts's copy of the file.
 */

const KEY = "__claw_reports_session_manager_instance__";

interface Global {
  [KEY]?: CronCapableSessionManager | null;
}

export function setSessionManager(sm: CronCapableSessionManager): void {
  (globalThis as Global)[KEY] = sm;
  console.log("> Reports SessionManager singleton registered (globalThis)");
}

export function getSessionManager(): CronCapableSessionManager | null {
  return (globalThis as Global)[KEY] ?? null;
}
