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
 * The `onresult` handler walks only the new entries starting at
 * `event.resultIndex` and tracks finalized text in a sticky ref. This
 * is what keeps the transcript correct on Android Chrome (where each
 * interim refinement is appended rather than replaced) and across the
 * auto-restart loop in `onend` (where a fresh recognizer instance
 * resets `event.results`).
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

  // Refs keep handler closures cheap and survive recognizer restarts.
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const stateRef = useRef<DictationState>("idle");
  // Sticky accumulator for finalized text across (a) interim refinements
  // within a session and (b) auto-restarts triggered by `onend`. Reset
  // only on a fresh user-initiated `start()`.
  const finalizedRef = useRef("");

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
    finalizedRef.current = "";
    setState("starting");

    // Build a fresh recognizer instance, wiring all handlers. The
    // `onend` auto-restart calls back into this same factory so each
    // restart gets a clean instance — Android Chrome occasionally
    // mis-handles a reused instance's results array.
    const createAndStart = (): void => {
      const rec = new Ctor();
      rec.lang = "sr-RS";
      rec.continuous = true;
      rec.interimResults = true;

      rec.onstart = () => {
        if (stateRef.current !== "recording") setState("recording");
      };

      rec.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.length === 0) continue;
          const chunk = result[0].transcript;
          if (result.isFinal) {
            finalizedRef.current += chunk;
          } else {
            interim += chunk;
          }
        }
        setTranscript(cyrillicToLatin(finalizedRef.current + interim));
      };

      rec.onerror = (event) => {
        // `aborted` fires when we stop()/abort() programmatically — silent.
        if (event.error === "aborted") return;
        setError(errorMessageFor(event.error));
      };

      rec.onend = () => {
        // Chromium-on-Android auto-stops on silence. If the user hasn't
        // pressed stop, spin up a fresh recognizer so dictation feels
        // continuous. The finalized text persists via finalizedRef.
        if (stateRef.current === "recording") {
          try {
            createAndStart();
            return;
          } catch {
            /* fall through to idle */
          }
        }
        setState("idle");
      };

      recognitionRef.current = rec;
      rec.start();
    };

    try {
      createAndStart();
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
