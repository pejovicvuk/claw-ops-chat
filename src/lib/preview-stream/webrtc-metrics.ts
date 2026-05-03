/**
 * Phase 4 (#130) hardening: process-wide counters for the WebRTC
 * preview pipeline. Exposed via `/api/health` so an SRE can tell
 * whether RTC is succeeding, falling back, or failing in the field.
 *
 * Pinned to `globalThis` (same pattern as ws-ticket-store) because
 * Next.js standalone builds duplicate module instances between the
 * custom server entry and the bundled API routes — a plain
 * module-local counter would silently double-track or under-track
 * depending on which import won.
 *
 * No PII recorded — counters only. Bumped at lifecycle points by
 * `webrtc-handler.ts` (server-side) and exposed read-only.
 */

const KEY = "__claw_webrtc_metrics__";

export interface WebRtcCounters {
  /** Both peers paired; relay is live. */
  paired: number;
  /** A pair never completed within PAIR_TIMEOUT_MS. */
  pair_timeout: number;
  /** Controller emitted capture_failed (getDisplayMedia denied / 0 tracks). */
  capture_failed: number;
  /** acquirePage threw (Chromium launch / navigation issue). */
  controller_spawn_failed: number;
  /** A peer hit MAX_CONCURRENT_RTC_ROOMS_PER_ACTOR. */
  rate_limited: number;
  /** A peer hit slot_taken (re-attach to filled slot). */
  slot_taken: number;
  /** Client flipped sticky-RTC-failure and switched to MSE. */
  fallback_to_mse: number;
  /** Client called restartIce() to recover a transient blip. */
  ice_restart: number;
}

interface Global {
  [KEY]?: WebRtcCounters;
}

function zero(): WebRtcCounters {
  return {
    paired: 0,
    pair_timeout: 0,
    capture_failed: 0,
    controller_spawn_failed: 0,
    rate_limited: 0,
    slot_taken: 0,
    fallback_to_mse: 0,
    ice_restart: 0,
  };
}

function getCounters(): WebRtcCounters {
  const g = globalThis as Global;
  if (!g[KEY]) g[KEY] = zero();
  return g[KEY];
}

export function bump(name: keyof WebRtcCounters): void {
  const c = getCounters();
  c[name] += 1;
}

export function snapshot(): WebRtcCounters {
  return { ...getCounters() };
}

export function _resetForTests(): void {
  const g = globalThis as Global;
  g[KEY] = zero();
}
