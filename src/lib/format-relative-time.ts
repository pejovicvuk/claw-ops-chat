/**
 * Relative-time formatting helpers for the HUD popup. The SDK emits
 * `resetsAt` timestamps for rate-limit windows — some fields arrive in
 * seconds, some in milliseconds — so we normalise first, then format
 * the delta against `now` into a human-friendly "Nd Nh Nm" string.
 */

/**
 * Normalise an SDK-emitted timestamp to milliseconds. Values below 10¹¹
 * (anything before the year 5138 if interpreted as ms) are treated as
 * seconds and multiplied by 1000; bigger values are already ms.
 */
export function toMillis(t: number | null | undefined): number | null {
  if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) return null;
  return t < 1e11 ? t * 1000 : t;
}

/**
 * Format a "resets in …" string for a future timestamp. Returns:
 *   "—"           if the timestamp is missing or invalid
 *   "now"         within 60s of reset (also when the target is in the past)
 *   "12m"         minutes only, under an hour
 *   "2h 14m"      hours + minutes, under a day
 *   "5d 8h"       days + hours, over a day
 */
export function formatResetsIn(resetsAtMs: number | null | undefined, nowMs: number): string {
  if (!resetsAtMs) return "—";
  const deltaMs = resetsAtMs - nowMs;
  if (deltaMs < 60_000) return "now";
  const totalMinutes = Math.floor(deltaMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
