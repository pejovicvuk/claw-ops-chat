/**
 * Shared constants for the composer toolbar pickers and the chat-view
 * keyboard shortcut handler. Kept in a plain `.ts` file (no JSX) so any
 * non-React code path (e.g. the Shift+Tab cycler in chat-view) can
 * import the same source of truth without dragging client-component
 * baggage with it.
 */

export type ModeValue = "default" | "acceptEdits" | "plan" | "auto";

export const MODE_LABELS: Record<ModeValue, string> = {
  default: "Default",
  acceptEdits: "Accept Edits",
  plan: "Plan Mode",
  auto: "Auto",
};

export interface ModeOption {
  value: ModeValue;
  label: string;
  description: string;
}

export const MODE_OPTIONS: ModeOption[] = [
  { value: "default", label: "Default", description: "Ask before edits and commands" },
  { value: "acceptEdits", label: "Accept Edits", description: "Auto-approve file edits" },
  { value: "plan", label: "Plan Mode", description: "Plan only, no changes" },
  { value: "auto", label: "Auto", description: "Model classifier decides (SDK)" },
];

/**
 * Reasoning-effort picker. Mirrors the SDK's `EffortLevel` (low | medium |
 * high | xhigh | max). Empty string means **Adaptive** thinking — the SDK
 * chooses a thinking budget per turn (`thinking: { type: 'adaptive' }`).
 */
export interface EffortOption {
  /** Empty string = Adaptive (no override). */
  value: "" | "low" | "medium" | "high" | "xhigh" | "max";
  label: string;
  /** Single-character glyph used on narrow viewports / segmented controls. */
  mobileLabel: string;
}

export const EFFORT_OPTIONS: EffortOption[] = [
  { value: "", label: "Adaptive", mobileLabel: "A" },
  { value: "low", label: "Low", mobileLabel: "L" },
  { value: "medium", label: "Med", mobileLabel: "M" },
  { value: "high", label: "High", mobileLabel: "H" },
  { value: "xhigh", label: "X-High", mobileLabel: "X" },
  { value: "max", label: "Max", mobileLabel: "✦" },
];

export interface ModelOption {
  /** Empty string = Auto (no override; SDK uses subscription default). */
  value: "" | "opus" | "sonnet" | "haiku";
  label: string;
  description: string;
}

/**
 * We surface the SDK's stable family aliases rather than concrete versions
 * so the picker keeps working when Anthropic ships a new minor (e.g.
 * Sonnet 4.6 → 4.7) without a code change. Empty string = Auto.
 */
export const MODEL_OPTIONS: ModelOption[] = [
  { value: "", label: "Auto", description: "SDK default for your subscription" },
  { value: "opus", label: "Opus", description: "Most capable for ambitious work" },
  { value: "sonnet", label: "Sonnet", description: "Balanced for everyday work" },
  { value: "haiku", label: "Haiku", description: "Fastest for light tasks" },
];

/**
 * Map the SDK's full model id (e.g. `claude-opus-4-7-20260301`) to its
 * family alias so the dropdown can show what's actually running when the
 * user has Auto selected. Returns null if we can't classify it.
 */
export function modelFamily(id: string | null | undefined): "opus" | "sonnet" | "haiku" | null {
  if (!id) return null;
  if (id.includes("opus")) return "opus";
  if (id.includes("sonnet")) return "sonnet";
  if (id.includes("haiku")) return "haiku";
  return null;
}

/** Lookup helpers — handy when callers want a label without writing a `.find()` chain inline. */
export function effortLabelFor(value: string | null | undefined): string {
  if (!value) return "Adaptive";
  return EFFORT_OPTIONS.find((o) => o.value === value)?.label ?? "Adaptive";
}

export function modelLabelFor(value: string | null | undefined): string {
  if (!value) return "Auto";
  return MODEL_OPTIONS.find((o) => o.value === value)?.label ?? "Auto";
}
