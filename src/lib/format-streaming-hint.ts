/**
 * Formatters for the hover tooltip on the live "thinking" / "tool_running"
 * indicator. Mirrors the `(Ns · ↓ M tokens)` style Claude Code shows in
 * the terminal so the chat HUD feels familiar to CLI users.
 *
 * Pure functions — no DOM, no Date.now() — so the call site controls
 * timing and the unit tests don't need to mock the clock.
 */

/**
 * Render an elapsed-millisecond duration as a compact human string.
 *   650        → "<1s"
 *   1_500      → "1s"
 *   59_999     → "59s"
 *   60_000     → "1m 0s"
 *   75_000     → "1m 15s"
 *   3_725_000  → "62m 5s"   (we never roll over to hours — turns rarely
 *                            run that long, and "1h 2m" is more characters
 *                            than the indicator has space for; if it ever
 *                            matters we can extend.)
 */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "<1s";
  if (ms < 1000) return "<1s";
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s}s`;
}

/**
 * Format a token count with thousands separators. Negative or non-finite
 * input renders as "0" rather than throwing — the caller is in a hot
 * render path and can't be expected to pre-validate every WebSocket
 * payload.
 */
export function formatTokens(n: number | undefined | null): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return "0";
  return Math.round(n).toLocaleString("en-US");
}

export interface StreamingHintParts {
  elapsedMs: number;
  /** Output tokens emitted on the latest assistant message snapshot. */
  outputTokens?: number;
  /** Input tokens on the latest assistant message snapshot. */
  inputTokens?: number;
}

/**
 * Build the full hover-tooltip string. Mirrors the terminal layout:
 *
 *   "12s · ↓ 487 tokens"                     (output only)
 *   "12s · ↓ 487 tokens · ↑ 12,300 in"       (both)
 *   "12s"                                    (no token data yet)
 *
 * Output tokens are treated as the "primary" figure because that's what
 * the user is watching tick up while Claude is actively writing. Input
 * tokens are appended only when present and non-zero — on a brand-new
 * turn before the first assistant chunk arrives, neither is known and
 * we just show elapsed.
 */
export function formatStreamingHint(parts: StreamingHintParts): string {
  const pieces: string[] = [formatElapsed(parts.elapsedMs)];
  const out = parts.outputTokens;
  if (typeof out === "number" && out > 0) {
    pieces.push(`↓ ${formatTokens(out)} tokens`);
  }
  const inp = parts.inputTokens;
  if (typeof inp === "number" && inp > 0) {
    pieces.push(`↑ ${formatTokens(inp)} in`);
  }
  return pieces.join(" · ");
}
