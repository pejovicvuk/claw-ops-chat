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
  /** Index into `results` where the new entries for this event start.
   *  Critical on Android Chrome: each interim refinement is appended
   *  as a new entry rather than mutating an existing one, so naive
   *  full-array concatenation produces duplicates ("DaDanDanas"). */
  readonly resultIndex: number;
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
  /** False on Firefox, iOS Safari, or during SSR — caller should hide the mic button. */
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

/**
 * iOS Safari (iPhone + iPad, including iPadOS that masquerades as
 * desktop MacIntel) exposes `webkitSpeechRecognition` but Apple gates
 * the underlying dictation service so `.start()` reliably fires
 * `onerror({error: "not-allowed"})` without ever prompting the user.
 * Treating iOS the same way we treat Firefox — feature-detect as
 * unsupported — keeps the UI clean.
 */
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
  // iPadOS 13+ reports as desktop macOS but is the only "MacIntel"
  // platform with a touch screen.
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  if (isIOS()) return null;
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
 * Edge) or `window.webkitSpeechRecognition` (desktop Safari). Hardcoded
 * to Serbian (`sr-RS`); whatever the recognizer returns (typically
 * Cyrillic) is passed through `cyrillicToLatin` before being exposed
 * as `transcript`, so the consumer can always treat the output as
 * Serbian Latin.
 *
 * Android-quirk defenses:
 *   - Each finalized result is keyed by its `event.results` index in a
 *     local Set; if Android Chrome re-fires `onresult` for the same
 *     finalized index (or stalls `resultIndex` at 0), we skip duplicate
 *     appends. This is what was causing "DanasDAnasDanas".
 *   - Interim text is taken as the *latest* interim chunk only, not
 *     concatenated across entries — Android Chrome sometimes appends
 *     each refinement as a new interim entry.
 *   - We do NOT auto-restart on `onend`. Continuous mode is requested
 *     but Android ignores it; restart loops were re-recognizing the
 *     trailing audio and contributing to duplicates. End-of-recognition
 *     just transitions to idle and the user clicks the mic again.
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

  // Refs keep handler closures cheap and outlive renders.
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const stateRef = useRef<DictationState>("idle");
  // Accumulator for text that has been moved out of `event.results`
  // (finalized). Reset on each fresh user-initiated `start()`.
  const finalizedRef = useRef("");

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Tear down on unmount.
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
    finalizedRef.current = "";
    setState("starting");

    const rec = new Ctor();
    rec.lang = "sr-RS";
    rec.continuous = true;
    rec.interimResults = true;

    // Indices in `event.results` we've already pulled into finalizedRef.
    // Skips re-appending the same word on Android Chrome, which sometimes
    // re-fires `onresult` for already-finalized indices and/or returns a
    // `resultIndex` that doesn't advance past them.
    const consumedFinalIndices = new Set<number>();

    rec.onstart = () => {
      setState("recording");
    };

    rec.onresult = (event) => {
      let lastInterim = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.length === 0) continue;
        const chunk = result[0].transcript;
        if (result.isFinal) {
          if (consumedFinalIndices.has(i)) continue;
          consumedFinalIndices.add(i);
          finalizedRef.current += chunk;
        } else {
          // Take the latest interim only — Android Chrome appends each
          // refinement as a new entry rather than mutating in place.
          lastInterim = chunk;
        }
      }
      setTranscript(cyrillicToLatin(finalizedRef.current + lastInterim));
    };

    rec.onerror = (event) => {
      // `aborted` fires when we stop()/abort() programmatically — silent.
      if (event.error === "aborted") return;
      setError(errorMessageFor(event.error));
    };

    rec.onend = () => {
      // No auto-restart. Continuous mode is honored on desktop but
      // ignored on Android; restart loops there re-recognized trailing
      // audio. Caller re-clicks the mic for another utterance.
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
    setState("idle");
    try {
      rec.stop();
    } catch {
      /* ignore */
    }
  }, []);

  return { supported, state, transcript, error, start, stop };
}
