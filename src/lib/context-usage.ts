/**
 * Context-window usage calculation. Mirrors what Claude Code's terminal
 * status line displays so the in-app HUD shows the same number the user
 * would see if they ran `claude` directly.
 *
 * The formula:
 *
 *     used = input_tokens + cache_read_input_tokens + cache_creation_input_tokens
 *
 * `output_tokens` is deliberately EXCLUDED — output isn't part of the
 * next turn's context, only input is. This matches the reference HUD
 * implementation (jarrodwatts/claude-hud, src/stdin.ts:134-141).
 *
 * CRITICAL CORRECTNESS NOTE — DO NOT SUM ACROSS TURNS:
 * The SDK's `result.modelUsage` payload aggregates token counts across
 * every assistant chunk in the turn. A 10-step turn with a 250K cached
 * prompt sums to ~2.5M; a 100-step run with the same cache reaches
 * ~25M. Using those cumulative totals as "context used" produces
 * impossible numbers like 1253 % of a 1 M window.
 *
 * Always read the **latest per-message** `usage` from a single
 * `assistant` event. Use `extractContextWindow()` (below) to learn the
 * authoritative window cap from `result.modelUsage` — but pull only
 * `contextWindow`, never the inputTokens / cacheReadInputTokens fields.
 */

/** Default cap when we haven't yet seen a `result` event for the session. */
export const DEFAULT_CONTEXT_WINDOW = 1_000_000;

/** Shape of the `usage` field on a per-message SDK assistant event. */
export interface AssistantUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/** Snapshot broadcast to clients and persisted in the store. */
export interface ContextUsageSnapshot {
  used: number;
  max: number;
  percentage: number;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

/**
 * Build a context-usage snapshot from a single assistant message's
 * `usage` field. The snapshot is the *latest* state — not a running
 * total. Each new assistant message produces a fresh snapshot that
 * REPLACES the previous one on the client.
 *
 * @param usage          The raw `usage` object from one assistant event.
 * @param model          Model id (e.g. `"claude-sonnet-4-5-20250929"`).
 * @param contextWindow  The model's context-window cap. Caller should
 *                       pass the cached value learned from a prior
 *                       `result.modelUsage[modelId].contextWindow`,
 *                       falling back to `DEFAULT_CONTEXT_WINDOW`.
 */
export function snapshotFromAssistantUsage(
  usage: AssistantUsage,
  model: string | null = null,
  contextWindow: number = DEFAULT_CONTEXT_WINDOW,
): ContextUsageSnapshot {
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const cacheCreateTokens = usage.cache_creation_input_tokens ?? 0;
  const used = inputTokens + cacheReadTokens + cacheCreateTokens;
  const max = contextWindow > 0 ? contextWindow : DEFAULT_CONTEXT_WINDOW;
  const percentage = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return {
    used,
    max,
    percentage,
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreateTokens,
  };
}

/**
 * Pull only the authoritative context-window cap (and its model id) out
 * of an SDK `result.modelUsage` payload. Never reads the inputTokens /
 * cacheReadInputTokens fields — those are cumulative across the turn
 * and would inflate "context used" if used as a snapshot.
 *
 * Returns null when the payload is missing, malformed, or the cap is
 * absent / zero / negative.
 */
export function extractContextWindow(
  modelUsage: unknown,
): { model: string; contextWindow: number } | null {
  if (!modelUsage || typeof modelUsage !== "object") return null;
  const entries = Object.entries(modelUsage as Record<string, unknown>);
  const first = entries[0];
  if (!first) return null;
  const [model, raw] = first;
  if (!model || !raw || typeof raw !== "object") return null;
  const ctxWin = (raw as { contextWindow?: unknown }).contextWindow;
  if (typeof ctxWin !== "number" || !Number.isFinite(ctxWin) || ctxWin <= 0) return null;
  return { model, contextWindow: ctxWin };
}
