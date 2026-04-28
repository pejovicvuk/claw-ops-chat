import { existsSync, readFileSync } from "fs";
import { mkdir, readFile, writeFile, chmod, unlink } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

import {
  DEFAULT_SETTINGS,
  isKnownLanguage,
  isSttProvider,
  isSummaryProvider,
  type SttProvider,
  type SummaryProvider,
} from "./stt-defaults";

/**
 * Stores voice-input (STT) settings + provider API keys on disk so the
 * browser never sees the keys. Mirrors the Trello / GitHub credential
 * pattern: a single mode-`0600` JSON file under `~/.claude/custom-stt/`.
 *
 * No MCP server is registered and no Claude SDK env injection happens —
 * these keys are read only by `/api/stt/transcribe` and (for summaries)
 * `/api/stt/transcribe`'s summary step.
 */

const SETTINGS_DIR = join(homedir(), ".claude", "custom-stt");
const SETTINGS_FILE = join(SETTINGS_DIR, "settings.json");

export interface SttSettings {
  enabled: boolean;
  sttProvider: SttProvider;
  inputLanguage: string;
  translateToEnglish: boolean;
  summaryEnabled: boolean;
  summaryProvider: SummaryProvider;
  summaryPrompt: string;
  /** Server-only — never returned to the browser. */
  openaiApiKey?: string;
  groqApiKey?: string;
  anthropicApiKey?: string;
}

/** Shape returned to the browser — keys redacted to booleans. */
export interface PublicSttSettings {
  enabled: boolean;
  sttProvider: SttProvider;
  inputLanguage: string;
  translateToEnglish: boolean;
  summaryEnabled: boolean;
  summaryProvider: SummaryProvider;
  summaryPrompt: string;
  hasOpenaiKey: boolean;
  hasGroqKey: boolean;
  hasAnthropicKey: boolean;
}

/**
 * Best-effort hydrate from a JSON blob: anything missing or invalid
 * falls back to the corresponding default. Used by both the settings
 * route (when serializing for the UI) and the transcribe route (when
 * reading creds at request time), so a half-filled file still produces
 * a valid working state.
 */
function hydrate(raw: unknown): SttSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const sttProvider = isSttProvider(r.sttProvider) ? r.sttProvider : DEFAULT_SETTINGS.sttProvider;
  const summaryProvider = isSummaryProvider(r.summaryProvider)
    ? r.summaryProvider
    : DEFAULT_SETTINGS.summaryProvider;
  const inputLanguage = isKnownLanguage(r.inputLanguage)
    ? (r.inputLanguage as string)
    : DEFAULT_SETTINGS.inputLanguage;

  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULT_SETTINGS.enabled,
    sttProvider,
    inputLanguage,
    translateToEnglish:
      typeof r.translateToEnglish === "boolean"
        ? r.translateToEnglish
        : DEFAULT_SETTINGS.translateToEnglish,
    summaryEnabled:
      typeof r.summaryEnabled === "boolean" ? r.summaryEnabled : DEFAULT_SETTINGS.summaryEnabled,
    summaryProvider,
    summaryPrompt:
      typeof r.summaryPrompt === "string" && r.summaryPrompt.trim().length > 0
        ? r.summaryPrompt
        : DEFAULT_SETTINGS.summaryPrompt,
    openaiApiKey: typeof r.openaiApiKey === "string" ? r.openaiApiKey : undefined,
    groqApiKey: typeof r.groqApiKey === "string" ? r.groqApiKey : undefined,
    anthropicApiKey: typeof r.anthropicApiKey === "string" ? r.anthropicApiKey : undefined,
  };
}

export async function saveSettings(next: SttSettings): Promise<void> {
  await mkdir(SETTINGS_DIR, { recursive: true });
  await writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2), "utf-8");
  try {
    await chmod(SETTINGS_FILE, 0o600);
  } catch {
    /* non-POSIX */
  }
}

export async function loadSettings(): Promise<SttSettings> {
  if (!existsSync(SETTINGS_FILE)) return hydrate(null);
  try {
    const raw = await readFile(SETTINGS_FILE, "utf-8");
    return hydrate(JSON.parse(raw));
  } catch {
    return hydrate(null);
  }
}

/** Sync read — used by the transcribe route's hot path. */
export function loadSettingsSync(): SttSettings {
  if (!existsSync(SETTINGS_FILE)) return hydrate(null);
  try {
    const raw = readFileSync(SETTINGS_FILE, "utf-8");
    return hydrate(JSON.parse(raw));
  } catch {
    return hydrate(null);
  }
}

export async function deleteSettings(): Promise<void> {
  if (existsSync(SETTINGS_FILE)) {
    await unlink(SETTINGS_FILE).catch(() => {});
  }
}

/** Strip the keys before sending the settings to the browser. */
export function toPublic(s: SttSettings): PublicSttSettings {
  return {
    enabled: s.enabled,
    sttProvider: s.sttProvider,
    inputLanguage: s.inputLanguage,
    translateToEnglish: s.translateToEnglish,
    summaryEnabled: s.summaryEnabled,
    summaryProvider: s.summaryProvider,
    summaryPrompt: s.summaryPrompt,
    hasOpenaiKey: Boolean(s.openaiApiKey && s.openaiApiKey.length > 0),
    hasGroqKey: Boolean(s.groqApiKey && s.groqApiKey.length > 0),
    hasAnthropicKey: Boolean(s.anthropicApiKey && s.anthropicApiKey.length > 0),
  };
}

/** Test seam — exposed so unit tests can inspect / clean the file path. */
export const __TEST_PATHS = { SETTINGS_DIR, SETTINGS_FILE };
