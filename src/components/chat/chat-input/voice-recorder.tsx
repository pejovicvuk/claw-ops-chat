"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiLoader, FiMic, FiSquare } from "react-icons/fi";
import { authFetch } from "@/lib/auth";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

interface VoiceRecorderProps {
  /**
   * Called with each completed transcription. The parent inserts the
   * text into the textarea (concatenated with a space if there's
   * existing content). When a summary was generated, the parent
   * receives `transcript + "\n\n---\n\n" + summary` as a single string —
   * the recorder doesn't split it because the chat composer is a single
   * textarea.
   */
  onTranscribed: (text: string) => void;
  /** Disable the button while the host (e.g. ChatInput) is offline. */
  disabled?: boolean;
}

interface PublicSettings {
  enabled: boolean;
  sttProvider: "openai" | "groq";
  hasOpenaiKey: boolean;
  hasGroqKey: boolean;
}

interface TranscribeResponse {
  transcript?: string;
  summary?: string;
  summaryError?: string;
  error?: string;
}

type RecorderState = "idle" | "starting" | "recording" | "transcribing";

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const mime of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return undefined;
}

/**
 * Mic button for the chat composer. Renders nothing unless STT is
 * enabled in settings AND a key for the configured provider is saved.
 *
 * Lifecycle:
 *   1. Mount → GET /api/stt/settings → decide whether to render at all.
 *   2. Click idle → getUserMedia + start MediaRecorder.
 *   3. Click recording → stop, gather blob, POST to /api/stt/transcribe.
 *   4. On success → onTranscribed(transcript [+ summary]).
 *
 * No persistent storage, no waveform — the source dictaphone's full UX
 * is overkill for an inline chat input.
 */
export function VoiceRecorder({ onTranscribed, disabled = false }: VoiceRecorderProps) {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string | undefined>(undefined);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);

  // Fetch settings on mount + whenever the settings overlay closes (we
  // listen for visibilitychange + a window 'focus' event to cheaply
  // refresh after the user changes settings without exposing a global
  // settings store).
  const refresh = useCallback(async () => {
    try {
      const res = await authFetch(`${BASE}/api/stt/settings`);
      if (!res.ok) {
        setSettings(null);
        return;
      }
      const data = (await res.json()) as PublicSettings;
      setSettings(data);
    } catch {
      setSettings(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const cleanupStream = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => {
    return () => cleanupStream();
  }, [cleanupStream]);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    setError(null);
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;
      const mime = pickMimeType();
      mimeRef.current = mime;
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onerror = () => {
        setError("Recording failed.");
        cleanupStream();
        setState("idle");
      };

      recorder.start();
      startedAtRef.current = Date.now();
      setElapsed(0);
      tickRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 250);
      setState("recording");
    } catch (err) {
      cleanupStream();
      setState("idle");
      const msg =
        err instanceof Error
          ? err.name === "NotAllowedError" || err.name === "SecurityError"
            ? "Microphone permission denied."
            : err.message
          : "Could not start microphone.";
      setError(msg);
    }
  }, [state, cleanupStream]);

  const stopAndTranscribe = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || state !== "recording") return;

    setState("transcribing");
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }

    // Wait for the final chunk before assembling the blob.
    await new Promise<void>((resolve) => {
      recorder.addEventListener(
        "stop",
        () => {
          resolve();
        },
        { once: true },
      );
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    const blob = new Blob(chunksRef.current, {
      type: mimeRef.current ?? "audio/webm",
    });
    chunksRef.current = [];
    recorderRef.current = null;

    if (blob.size === 0) {
      setState("idle");
      setError("No audio captured.");
      return;
    }

    try {
      const form = new FormData();
      form.append("audio", blob, "voice-input.webm");
      const res = await authFetch(`${BASE}/api/stt/transcribe`, {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as TranscribeResponse;
      if (!res.ok) {
        throw new Error(data.error ?? `Transcription failed (${res.status})`);
      }
      const transcript = (data.transcript ?? "").trim();
      if (!transcript) {
        setError("Transcription returned no text.");
        setState("idle");
        return;
      }
      const summary = data.summary?.trim();
      const composed = summary ? `${transcript}\n\n---\n\n${summary}` : transcript;
      onTranscribed(composed);
      if (data.summaryError) setError(`Summary skipped: ${data.summaryError}`);
      setState("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcription failed.");
      setState("idle");
    }
  }, [state, onTranscribed]);

  const buttonReady = useMemo(() => {
    if (!settings || !settings.enabled) return false;
    return settings.sttProvider === "groq" ? settings.hasGroqKey : settings.hasOpenaiKey;
  }, [settings]);

  if (!buttonReady) return null;

  const isRecording = state === "recording";
  const isBusy = state === "starting" || state === "transcribing";
  const isDisabled = disabled || isBusy;

  const onClick = () => {
    if (isRecording) void stopAndTranscribe();
    else void start();
  };

  return (
    <div className="relative flex shrink-0 items-center">
      <button
        type="button"
        onClick={onClick}
        disabled={isDisabled}
        title={
          isRecording
            ? `Stop & transcribe (${formatElapsed(elapsed)})`
            : isBusy
              ? "Working…"
              : "Record voice message"
        }
        aria-label={isRecording ? "Stop recording" : "Record voice message"}
        className={`mb-0.5 flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-150 ${
          isRecording
            ? "bg-red-500 text-white hover:bg-red-600"
            : "text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
        } disabled:opacity-40`}
      >
        {state === "transcribing" ? (
          <FiLoader size={14} className="animate-spin" />
        ) : isRecording ? (
          <FiSquare size={11} fill="currentColor" />
        ) : (
          <FiMic size={15} />
        )}
      </button>
      {isRecording && (
        <span
          aria-live="polite"
          className="pointer-events-none absolute right-9 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-red-500 px-1.5 py-0.5 font-mono text-[10px] text-white"
        >
          {formatElapsed(elapsed)}
        </span>
      )}
      {error && state === "idle" && (
        <span
          role="alert"
          className="pointer-events-none absolute -top-7 right-0 max-w-[200px] truncate rounded-md bg-red-500/10 px-2 py-1 text-[10px] text-red-500"
        >
          {error}
        </span>
      )}
    </div>
  );
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
