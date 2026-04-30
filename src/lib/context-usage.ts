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
 * `result.modelUsage` is keyed by *every* model used during the turn —
 * which often includes Haiku (200 K window) when a Task subagent ran,
 * alongside the user's main model (Sonnet/Opus on a 1 M window).
 * Picking the wrong entry sets the bar's cap to 200 K and inflates the
 * displayed percentage. Selection priority:
 *
 *   1. The model whose id matches `preferredModelId` (the most-recent
 *      main-thread assistant model the session has seen). This is the
 *      authoritative pick for the HUD.
 *   2. The entry with the largest `contextWindow`. Defensible because
 *      the user's main model almost always has a larger window than
 *      any auxiliary subagent (1 M vs 200 K).
 *
 * Returns null when the payload is missing, malformed, or no entry has
 * a positive cap.
 */
export function extractContextWindow(
  modelUsage: unknown,
  preferredModelId?: string | null,
): { model: string; contextWindow: number } | null {
  if (!modelUsage || typeof modelUsage !== "object") return null;
  const entries: Array<{ model: string; contextWindow: number }> = [];
  for (const [model, raw] of Object.entries(modelUsage as Record<string, unknown>)) {
    if (!model || !raw || typeof raw !== "object") continue;
    const ctxWin = (raw as { contextWindow?: unknown }).contextWindow;
    if (typeof ctxWin !== "number" || !Number.isFinite(ctxWin) || ctxWin <= 0) continue;
    entries.push({ model, contextWindow: ctxWin });
  }
  if (entries.length === 0) return null;

  if (preferredModelId) {
    const match = entries.find((e) => e.model === preferredModelId);
    if (match) return match;
  }
  // Fallback: largest-window entry. Stable on ties (returns the first).
  return entries.reduce((best, e) => (e.contextWindow > best.contextWindow ? e : best));
}
