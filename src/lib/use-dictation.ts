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

/**
 * Merge a freshly-arrived transcript chunk with the text we've already
 * accepted. Handles the three Android Chrome behaviors we've observed:
 *
 *   1. Cumulative — new chunk is a superset of current ("Danas sam"
 *      arrives when current is "Danas"). Replace.
 *   2. Re-fire / stale — new chunk is a substring of current ("Danas"
 *      arrives again after "Danas sam" is already in). Keep current.
 *   3. New utterance — neither is a prefix of the other ("zdravo" after
 *      "Hello"). Append with a single separating space.
 *
 * Comparison is case-insensitive because the recognizer's casing wobbles
 * between fires ("Danas" / "DAnas" / "danas").
 */
export function reconcileChunk(current: string, incoming: string): string {
  if (!incoming) return current;
  if (!current) return incoming;
  const a = current.toLowerCase().trim();
  const b = incoming.toLowerCase().trim();
  // Case-insensitively identical — prefer incoming so refined casing
  // from the recognizer's later passes wins.
  if (a === b) return incoming;
  if (b.startsWith(a)) return incoming; // cumulative
  if (a.startsWith(b)) return current; // stale re-fire
  const sep = current.endsWith(" ") || incoming.startsWith(" ") ? "" : " ";
  return current + sep + incoming;
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
 *   - Android Chrome produces *cumulative* finalized results: each new
 *     final entry contains the entire phrase so far ("Danas" → "Danas
 *     sam" → "Danas sam bio"). Naive accumulation gives the user the
 *     concatenation of all of those. We detect cumulation via a
 *     case-insensitive prefix check and *replace* instead of appending
 *     when the new chunk is a superset of what we have. Truly new
 *     utterances (no prefix relationship) still append with spacing.
 *   - We do NOT auto-restart on `onend`. Continuous mode is requested
 *     but Android ignores it; restart loops were re-recognizing the
 *     trailing audio. End-of-recognition just transitions to idle and
 *     the user clicks the mic again.
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
          finalizedRef.current = reconcileChunk(finalizedRef.current, chunk);
        } else {
          // Take the latest interim only — interim entries are sometimes
          // appended (Android) rather than mutated in place.
          lastInterim = chunk;
        }
      }
      // Treat interim with the same cumulative-vs-append logic so
      // mid-utterance ticks don't double-print the phrase.
      const withInterim = lastInterim
        ? reconcileChunk(finalizedRef.current, lastInterim)
        : finalizedRef.current;
      setTranscript(cyrillicToLatin(withInterim));
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
