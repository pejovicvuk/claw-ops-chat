"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cyrillicToLatin } from "./serbian-transliterate";

// ── Ambient types for the Web Speech API ─────────────────────────────
// The spec is a W3C/WICG draft so TypeScript's lib.dom.d.ts does not
// ship these. We declare the slice we actually use rather than pulling
// in `@types/dom-speech-recognition`.

interface SpeechRecognitionAlternative {
  readonly transcript: string;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionCtor {
  new (): SpeechRecognitionInstance;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

// ─────────────────────────────────────────────────────────────────────

export type DictationState = "idle" | "starting" | "recording";

export interface UseDictationResult {
  /** False on Firefox or during SSR — caller should hide the mic button. */
  supported: boolean;
  state: DictationState;
  /** Accumulated transcript since the current recording started, already
   *  transliterated to Serbian Latin. Empty string when idle. */
  transcript: string;
  /** Last user-facing error message, or null. Cleared on next start(). */
  error: string | null;
  start(): void;
  stop(): void;
}

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function errorMessageFor(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone permission denied.";
    case "no-speech":
      return "No speech detected.";
    case "audio-capture":
      return "No microphone found.";
    case "network":
      return "Network error — speech recognition needs internet.";
    case "language-not-supported":
      return "Serbian recognition not available in this browser.";
    default:
      return "Speech recognition failed.";
  }
}

/**
 * Live dictation hook backed by `window.SpeechRecognition` (Chrome,
 * Edge) or `window.webkitSpeechRecognition` (Safari). Hardcoded to
 * Serbian (`sr-RS`); whatever the recognizer returns (typically
 * Cyrillic) is passed through `cyrillicToLatin` before being exposed
 * as `transcript`, so the consumer can always treat the output as
 * Serbian Latin.
 *
 * Caller pattern: snapshot the textarea content when `state` flips to
 * `"recording"`, then on every `transcript` update set the textarea
 * to `snapshot + " " + transcript`.
 */
export function useDictation(): UseDictationResult {
  // Lazy init: getCtor() runs once on first render, the result is stable
  // for the component's lifetime. Using state (not a ref) keeps the
  // value readable during render — see eslint react-hooks/refs.
  const [Ctor] = useState<SpeechRecognitionCtor | null>(() => getCtor());
  const supported = Ctor !== null;

  const [state, setState] = useState<DictationState>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Keep recognition instance + state in refs so the event handlers
  // see fresh values without re-creating the recognizer on every render.
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const stateRef = useRef<DictationState>("idle");
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Tear down on unmount. We null the onend handler first so the
  // restart-on-end loop doesn't fire mid-cleanup.
  useEffect(() => {
    return () => {
      const rec = recognitionRef.current;
      if (!rec) return;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.onstart = null;
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    if (!Ctor) return;
    if (stateRef.current !== "idle") return;

    setError(null);
    setTranscript("");
    setState("starting");

    const rec = new Ctor();
    rec.lang = "sr-RS";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onstart = () => {
      setState("recording");
    };

    rec.onresult = (event) => {
      let combined = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.length > 0) combined += result[0].transcript;
      }
      setTranscript(cyrillicToLatin(combined));
    };

    rec.onerror = (event) => {
      // `aborted` fires when we stop()/abort() programmatically — silent.
      if (event.error === "aborted") return;
      setError(errorMessageFor(event.error));
    };

    rec.onend = () => {
      // Chrome on Android auto-stops on silence. If the user hasn't
      // pressed stop, transparently restart the recognizer so the
      // dictation session feels continuous.
      if (stateRef.current === "recording") {
        try {
          rec.start();
          return;
        } catch {
          /* fall through to idle */
        }
      }
      setState("idle");
    };

    recognitionRef.current = rec;
    try {
      rec.start();
    } catch (err) {
      setState("idle");
      setError(err instanceof Error ? err.message : "Could not start dictation.");
      recognitionRef.current = null;
    }
  }, [Ctor]);

  const stop = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    // Flip state BEFORE calling stop() so the onend handler's
    // restart-loop check sees "not recording" and falls through to idle.
    setState("idle");
    try {
      rec.stop();
    } catch {
      /* ignore */
    }
  }, []);

  return { supported, state, transcript, error, start, stop };
}
