/**
 * Server-side helpers that call OpenAI / Groq / Anthropic on behalf of
 * the voice-input feature. All keys live in `~/.claude/custom-stt/` and
 * are read by the API routes — these functions are pure HTTP and never
 * touch the filesystem themselves.
 *
 * Two surfaces:
 *   - transcribeWith*: send an audio Blob, receive transcript text.
 *   - summarizeWith*: send transcript text + prompt, receive summary.
 */

import type { SttProvider, SummaryProvider } from "./stt-defaults";

export class ProviderError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface TranscribeOptions {
  /** Audio file as a Blob (webm/wav/mp3/m4a). */
  audio: Blob;
  /** Suggested filename — Whisper sniffs the extension. */
  filename: string;
  /** ISO-639-1 hint, or "auto" for no hint. */
  language: string;
  /** When true, force English output via the `/audio/translations` endpoint. */
  translateToEnglish: boolean;
  apiKey: string;
}

interface WhisperResponse {
  text?: string;
  error?: { message?: string };
}

/**
 * OpenAI Whisper. The same provider exposes two endpoints — `transcriptions`
 * keeps the source language; `translations` always emits English. We pick
 * one based on `translateToEnglish`. The `language` hint is only valid on
 * the transcriptions endpoint.
 */
export async function transcribeWithOpenAI(opts: TranscribeOptions): Promise<string> {
  const url = opts.translateToEnglish
    ? "https://api.openai.com/v1/audio/translations"
    : "https://api.openai.com/v1/audio/transcriptions";

  const form = new FormData();
  form.append("file", opts.audio, opts.filename);
  form.append("model", "whisper-1");
  if (!opts.translateToEnglish && opts.language && opts.language !== "auto") {
    form.append("language", opts.language);
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });

  return readWhisperResponse(res, "OpenAI");
}

/**
 * Groq's Whisper-large-v3 endpoint speaks the OpenAI shape. Same split
 * between transcriptions vs. translations.
 */
export async function transcribeWithGroq(opts: TranscribeOptions): Promise<string> {
  const url = opts.translateToEnglish
    ? "https://api.groq.com/openai/v1/audio/translations"
    : "https://api.groq.com/openai/v1/audio/transcriptions";

  const form = new FormData();
  form.append("file", opts.audio, opts.filename);
  form.append("model", "whisper-large-v3");
  if (!opts.translateToEnglish && opts.language && opts.language !== "auto") {
    form.append("language", opts.language);
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });

  return readWhisperResponse(res, "Groq");
}

async function readWhisperResponse(res: Response, label: string): Promise<string> {
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError(`${label} rejected the API key.`, 401);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as WhisperResponse;
    throw new ProviderError(
      body.error?.message ?? `${label} returned status ${res.status}`,
      res.status,
    );
  }
  const data = (await res.json()) as WhisperResponse;
  if (typeof data.text !== "string") {
    throw new ProviderError(`${label} returned no transcript text.`, 502);
  }
  return data.text.trim();
}

export async function transcribe(provider: SttProvider, opts: TranscribeOptions): Promise<string> {
  if (provider === "groq") return transcribeWithGroq(opts);
  return transcribeWithOpenAI(opts);
}

// ── Summarisation ────────────────────────────────────────────────────────

export interface SummarizeOptions {
  transcript: string;
  systemPrompt: string;
  apiKey: string;
}

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

/** OpenAI / Groq share the same chat-completions shape. */
async function summarizeOpenAICompatible(
  url: string,
  model: string,
  label: string,
  opts: SummarizeOptions,
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.transcript },
      ],
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError(`${label} rejected the API key.`, 401);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as OpenAIChatResponse;
    throw new ProviderError(
      body.error?.message ?? `${label} returned status ${res.status}`,
      res.status,
    );
  }
  const data = (await res.json()) as OpenAIChatResponse;
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new ProviderError(`${label} returned no summary text.`, 502);
  }
  return content.trim();
}

export function summarizeWithOpenAI(opts: SummarizeOptions): Promise<string> {
  return summarizeOpenAICompatible(
    "https://api.openai.com/v1/chat/completions",
    "gpt-4o-mini",
    "OpenAI",
    opts,
  );
}

export function summarizeWithGroq(opts: SummarizeOptions): Promise<string> {
  return summarizeOpenAICompatible(
    "https://api.groq.com/openai/v1/chat/completions",
    "llama-3.3-70b-versatile",
    "Groq",
    opts,
  );
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  error?: { message?: string };
}

export async function summarizeWithAnthropic(opts: SummarizeOptions): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
      system: opts.systemPrompt,
      messages: [{ role: "user", content: opts.transcript }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError("Anthropic rejected the API key.", 401);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as AnthropicResponse;
    throw new ProviderError(
      body.error?.message ?? `Anthropic returned status ${res.status}`,
      res.status,
    );
  }
  const data = (await res.json()) as AnthropicResponse;
  const text = data.content?.find((b) => b.type === "text")?.text;
  if (typeof text !== "string") {
    throw new ProviderError("Anthropic returned no summary text.", 502);
  }
  return text.trim();
}

export async function summarize(
  provider: SummaryProvider,
  opts: SummarizeOptions,
): Promise<string> {
  if (provider === "anthropic") return summarizeWithAnthropic(opts);
  if (provider === "groq") return summarizeWithGroq(opts);
  return summarizeWithOpenAI(opts);
}

// ── Key-validation probes (used by /api/stt/settings POST) ───────────────

/**
 * Cheap GET that succeeds with any working key. We don't fail on
 * non-401/403 errors (e.g. 5xx, network) since transient upstream
 * issues shouldn't block the user from saving a key they typed
 * correctly.
 */
export async function probeOpenAIKey(
  apiKey: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "OpenAI rejected this API key." };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `Could not reach OpenAI: ${describeError(err)}` };
  }
}

export async function probeGroqKey(
  apiKey: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "Groq rejected this API key." };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `Could not reach Groq: ${describeError(err)}` };
  }
}

export async function probeAnthropicKey(
  apiKey: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "Anthropic rejected this API key." };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `Could not reach Anthropic: ${describeError(err)}` };
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
