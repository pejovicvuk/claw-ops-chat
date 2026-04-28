/**
 * Static data + sensible defaults for the voice-input (speech-to-text)
 * settings. Imported by both the API routes and the settings page so the
 * dropdown options + the default prompt stay in lock-step.
 *
 * Keys are kept server-side (~/.claude/custom-stt/settings.json); the
 * defaults here describe the *non-secret* settings users see in the form.
 */

export const STT_PROVIDERS = ["openai", "groq"] as const;
export type SttProvider = (typeof STT_PROVIDERS)[number];

export const SUMMARY_PROVIDERS = ["openai", "anthropic", "groq"] as const;
export type SummaryProvider = (typeof SUMMARY_PROVIDERS)[number];

export interface LanguageOption {
  /** Whisper-compatible ISO-639-1 code, or `"auto"` to skip the hint. */
  code: string;
  /** Human label shown in the dropdown. */
  label: string;
}

/**
 * Language hints accepted by the OpenAI / Groq Whisper transcription
 * endpoint. `auto` means no hint — Whisper will detect on its own.
 */
export const LANGUAGES: LanguageOption[] = [
  { code: "auto", label: "Auto-detect" },
  { code: "en", label: "English" },
  { code: "sr", label: "Serbian" },
  { code: "zh", label: "Mandarin Chinese" },
  { code: "hr", label: "Croatian" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "ru", label: "Russian" },
  { code: "uk", label: "Ukrainian" },
  { code: "pl", label: "Polish" },
  { code: "tr", label: "Turkish" },
  { code: "ar", label: "Arabic" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "hi", label: "Hindi" },
];

/**
 * Default summary prompt — content-adaptive, drops sections that don't
 * apply to the spoken material. Pre-filled into the textarea so users
 * get a useful summary out of the box; they can edit freely.
 */
export const DEFAULT_SUMMARY_PROMPT = `You are a precise note-taker turning a spoken transcript into a clean, scannable summary.

Read the transcript and produce a Markdown summary that adapts to its content:

- **TL;DR** — 1–2 sentences capturing the core point.
- **Key points** — 3–7 bullets covering the main ideas, decisions, observations, or facts; each under ~20 words.
- **Action items** — bullets in the form "[Owner] — [verb] [object] [optional deadline]". Include only if tasks were named; otherwise omit the whole section.
- **Open questions** — bullets capturing anything left undecided or needing follow-up. Omit if none.

Rules: keep the speaker's wording where natural; do not invent facts; preserve names, numbers, and dates exactly; output Markdown only — no preamble, no sign-off.`;

export interface PublicSttDefaults {
  enabled: boolean;
  sttProvider: SttProvider;
  inputLanguage: string;
  translateToEnglish: boolean;
  summaryEnabled: boolean;
  summaryProvider: SummaryProvider;
  summaryPrompt: string;
}

/** Defaults applied when no settings file exists yet, or when a field is missing. */
export const DEFAULT_SETTINGS: PublicSttDefaults = {
  enabled: false,
  sttProvider: "openai",
  inputLanguage: "auto",
  translateToEnglish: true,
  summaryEnabled: false,
  summaryProvider: "openai",
  summaryPrompt: DEFAULT_SUMMARY_PROMPT,
};

export function isSttProvider(value: unknown): value is SttProvider {
  return typeof value === "string" && (STT_PROVIDERS as readonly string[]).includes(value);
}

export function isSummaryProvider(value: unknown): value is SummaryProvider {
  return typeof value === "string" && (SUMMARY_PROVIDERS as readonly string[]).includes(value);
}

export function isKnownLanguage(value: unknown): boolean {
  return typeof value === "string" && LANGUAGES.some((l) => l.code === value);
}
