import type { PushEventKind } from "./types";

/**
 * Server-side ring buffer of recent push delivery attempts. Surfaces
 * via /api/push/diagnostics so the settings UI can confirm whether a
 * missed notification was a server-side drop (subscription gone, web
 * push 5xx, VAPID misconfigured) or a client-side miss (OS suppressed,
 * tag dedup'd, etc).
 *
 * Lives in-memory only — we already write the same outcomes to the
 * audit log for durable storage; this is purely the "last 50 sends"
 * window for live debugging.
 */

export interface DiagnosticsEntry {
  ts: number;
  email: string;
  /** Truncated device label so logs are stable across UA tweaks. */
  device: string;
  kind: PushEventKind;
  outcome: "sent" | "dropped" | "error";
  /**
   * HTTP status returned by the upstream push service. Set whenever the
   * web-push call produced a `WebPushError` (success cases leave this
   * undefined). Surfaced in the diagnostics panel so a 401 vs a 410
   * vs a 5xx is visually distinguishable instead of all being labelled
   * "error".
   */
  statusCode?: number;
  detail?: string;
}

const MAX_ENTRIES = 50;
const buffer: DiagnosticsEntry[] = [];

export function recordSend(entry: DiagnosticsEntry): void {
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES);
  }
}

/**
 * Recent entries, newest first. Optionally filter by user email so a
 * multi-user deployment never leaks one user's delivery history to
 * another (today's app is single-user but the contract is cheap to
 * uphold).
 */
export function recentSends(email?: string, limit = 20): DiagnosticsEntry[] {
  const filtered = email ? buffer.filter((e) => e.email === email) : buffer.slice();
  return filtered.slice(-limit).reverse();
}

/** Test helper. */
export function clearDiagnostics(): void {
  buffer.length = 0;
}
