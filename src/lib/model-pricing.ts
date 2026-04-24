/**
 * Per-million-token USD rates for current Anthropic Claude models. Used by
 * the session HUD to display running session cost. Rates are conservative
 * estimates — Anthropic's billing is authoritative — and we intentionally
 * fall back to `null` for unknown model IDs so the UI shows "—" rather
 * than a misleading dollar figure.
 *
 * Rates cover four token classes the Claude Agent SDK reports:
 *   - input           (prompt tokens not served from cache)
 *   - output          (sampled / thinking tokens)
 *   - cacheRead       (tokens read from the prompt cache — ~10% of input)
 *   - cacheCreate     (tokens written to the prompt cache — 125% of input)
 *
 * Matched against the model id the SDK emits in `modelUsage` (and on each
 * assistant message). We normalise the id by stripping any date suffix
 * (`-20250101` etc.) so a single entry covers minor version bumps.
 */

export interface ModelRates {
  /** Display label shown in the HUD popup. */
  label: string;
  /** Per-million-token USD prices. */
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}

/** Per-million-token USD rates. Update when Anthropic publishes new prices. */
export const MODEL_RATES: Record<string, ModelRates> = {
  // Claude 4.x family
  "claude-opus-4": { label: "Opus 4", input: 15, output: 75, cacheRead: 1.5, cacheCreate: 18.75 },
  "claude-opus-4-7": {
    label: "Opus 4.7",
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheCreate: 18.75,
  },
  "claude-sonnet-4": { label: "Sonnet 4", input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
  "claude-sonnet-4-6": {
    label: "Sonnet 4.6",
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheCreate: 3.75,
  },
  "claude-haiku-4-5": {
    label: "Haiku 4.5",
    input: 1,
    output: 5,
    cacheRead: 0.1,
    cacheCreate: 1.25,
  },
  // Claude 3.x legacy (still served by some deployments).
  "claude-3-5-sonnet": {
    label: "Sonnet 3.5",
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheCreate: 3.75,
  },
  "claude-3-5-haiku": {
    label: "Haiku 3.5",
    input: 0.8,
    output: 4,
    cacheRead: 0.08,
    cacheCreate: 1,
  },
  "claude-3-opus": { label: "Opus 3", input: 15, output: 75, cacheRead: 1.5, cacheCreate: 18.75 },
};

/** Strip a trailing ISO-ish date suffix from an SDK-reported model id. */
export function normalizeModelId(raw: string): string {
  // Examples we normalise:
  //   claude-opus-4-7-20260301      → claude-opus-4-7
  //   claude-sonnet-4-6-20251001    → claude-sonnet-4-6
  //   claude-3-5-sonnet-20241022    → claude-3-5-sonnet
  return raw.replace(/-\d{8}$/, "").replace(/@.+$/, "");
}

/** Look up the rates for an SDK model id, or null when unknown. */
export function ratesFor(model: string | null | undefined): ModelRates | null {
  if (!model) return null;
  const key = normalizeModelId(model);
  return MODEL_RATES[key] ?? null;
}

export interface CostInput {
  model: string | null | undefined;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

/**
 * Total USD cost for a single model call. Returns null when the model id
 * isn't in our rates table so the UI can render "—" instead of lying with
 * a $0.00.
 */
export function computeCost(usage: CostInput): number | null {
  const rates = ratesFor(usage.model);
  if (!rates) return null;
  const perMillion = 1_000_000;
  return (
    (usage.inputTokens * rates.input) / perMillion +
    (usage.outputTokens * rates.output) / perMillion +
    (usage.cacheReadTokens * rates.cacheRead) / perMillion +
    (usage.cacheCreateTokens * rates.cacheCreate) / perMillion
  );
}

/** Format a USD amount for the HUD popup. Small amounts get four decimals. */
export function formatCost(cost: number | null): string {
  if (cost === null) return "—";
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}
