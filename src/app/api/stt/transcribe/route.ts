import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { loadSettingsSync } from "@/lib/stt-custom-config";
import { ProviderError, summarize, transcribe } from "@/lib/stt-providers";

/**
 * POST `/api/stt/transcribe` — accepts a `multipart/form-data` body with
 * a single `audio` field (webm / wav / mp3). Reads provider + key from
 * `~/.claude/custom-stt/settings.json`, calls the chosen Whisper-style
 * endpoint, and (if summaryEnabled) follows up with the configured LLM
 * for a structured summary.
 *
 * Returns `{ transcript, summary?, durationMs }`.
 */

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // OpenAI Whisper hard limit
const ALLOWED_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/flac",
]);

async function postHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  const settings = loadSettingsSync();
  if (!settings.enabled) {
    return Response.json(
      { error: "Voice input is disabled. Enable it in Settings → Voice input." },
      { status: 400 },
    );
  }

  const sttKey = settings.sttProvider === "groq" ? settings.groqApiKey : settings.openaiApiKey;
  if (!sttKey) {
    return Response.json(
      {
        error: `No API key configured for ${settings.sttProvider}. Add one in Settings → Voice input.`,
      },
      { status: 400 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data body." }, { status: 400 });
  }

  const file = form.get("audio");
  if (!(file instanceof Blob)) {
    return Response.json({ error: "Missing 'audio' field." }, { status: 400 });
  }
  if (file.size === 0) {
    return Response.json({ error: "Audio file is empty." }, { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return Response.json(
      {
        error: `Audio is too large (${Math.round(file.size / 1024 / 1024)} MB). Max is 25 MB.`,
      },
      { status: 413 },
    );
  }
  // Loose mime sniff — Whisper needs a recognisable extension. We tolerate
  // missing/unknown types since some browsers report an empty type for
  // MediaRecorder blobs.
  if (file.type && !ALLOWED_AUDIO_TYPES.has(file.type) && !file.type.startsWith("audio/")) {
    return Response.json({ error: `Unsupported audio type: ${file.type}` }, { status: 415 });
  }

  const filename = filenameForType(file.type);

  const startedAt = Date.now();
  let transcript: string;
  try {
    transcript = await transcribe(settings.sttProvider, {
      audio: file,
      filename,
      language: settings.inputLanguage,
      translateToEnglish: settings.translateToEnglish,
      apiKey: sttKey,
    });
  } catch (err) {
    return providerErrorResponse(err);
  }

  let summary: string | undefined;
  if (settings.summaryEnabled && transcript.length > 0) {
    const summaryKey = pickSummaryKey(settings);
    if (!summaryKey) {
      // Soft-fail summarisation: still return the transcript with a note,
      // since transcribe already cost the user a Whisper call.
      return Response.json({
        transcript,
        summary: undefined,
        summaryError: `No API key configured for ${settings.summaryProvider}.`,
        durationMs: Date.now() - startedAt,
      });
    }
    try {
      summary = await summarize(settings.summaryProvider, {
        transcript,
        systemPrompt: settings.summaryPrompt,
        apiKey: summaryKey,
      });
    } catch (err) {
      const reason = err instanceof ProviderError ? err.message : "Summary failed.";
      return Response.json({
        transcript,
        summary: undefined,
        summaryError: reason,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  return Response.json({
    transcript,
    summary,
    durationMs: Date.now() - startedAt,
  });
}

function filenameForType(mime: string): string {
  if (mime.includes("wav")) return "audio.wav";
  if (mime.includes("mp4") || mime.includes("m4a")) return "audio.m4a";
  if (mime.includes("mpeg")) return "audio.mp3";
  if (mime.includes("ogg")) return "audio.ogg";
  if (mime.includes("flac")) return "audio.flac";
  return "audio.webm";
}

function pickSummaryKey(settings: {
  summaryProvider: "openai" | "anthropic" | "groq";
  openaiApiKey?: string;
  anthropicApiKey?: string;
  groqApiKey?: string;
}): string | undefined {
  if (settings.summaryProvider === "openai") return settings.openaiApiKey || undefined;
  if (settings.summaryProvider === "anthropic") return settings.anthropicApiKey || undefined;
  return settings.groqApiKey || undefined;
}

function providerErrorResponse(err: unknown): Response {
  if (err instanceof ProviderError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  return Response.json(
    { error: err instanceof Error ? err.message : "Transcription failed." },
    { status: 502 },
  );
}

export const POST = withAudit(
  { route: "/api/stt/transcribe", label: "STT transcribe" },
  postHandler,
);
