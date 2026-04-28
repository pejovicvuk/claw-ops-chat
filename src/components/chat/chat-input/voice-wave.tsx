"use client";

import { useEffect, useRef } from "react";

interface VoiceWaveProps {
  /**
   * Live mic stream. When `null`, the bars settle to their resting min
   * height and the analyser tear-down runs. Pass the stream owned by
   * VoiceRecorder.
   */
  stream: MediaStream | null;
  /** Number of vertical pills. Default 24 — fits the composer width. */
  bars?: number;
  className?: string;
}

const FFT_SIZE = 256; // → 128 frequency bins
const MIN_PCT = 14; // resting bar height
const MAX_PCT = 96; // bar height at full amplitude
const SMOOTHING = 0.55; // EMA factor — lower = snappier, higher = smoother
const ANALYSER_SMOOTHING = 0.7; // built-in WebAudio smoothing

/**
 * Real-time microphone visualisation. Renders N vertical pill-shaped
 * bars whose heights track the FFT bins of the live MediaStream. Uses
 * direct DOM mutation (no React state per frame) so 60fps painting
 * doesn't churn the reconciler.
 *
 * Cleanup: tearing down the AudioContext on unmount / stream change is
 * what frees the mic indicator + audio worklet thread.
 */
export function VoiceWave({ stream, bars = 24, className = "" }: VoiceWaveProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const heightsRef = useRef<number[]>(new Array(bars).fill(MIN_PCT));
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (heightsRef.current.length !== bars) {
      heightsRef.current = new Array(bars).fill(MIN_PCT);
    }

    const paint = () => {
      const container = containerRef.current;
      if (!container) return;
      const children = container.children;
      const heights = heightsRef.current;
      for (let i = 0; i < bars && i < children.length; i++) {
        (children[i] as HTMLDivElement).style.height = `${heights[i]}%`;
      }
    };

    if (!stream) {
      heightsRef.current = new Array(bars).fill(MIN_PCT);
      paint();
      return;
    }

    // Some browsers (Chromium-derivatives) require an explicit constructor
    // capability check; fall back to the webkit-prefixed one for Safari < 14.
    const Ctor =
      typeof window !== "undefined" &&
      ((window.AudioContext as typeof AudioContext | undefined) ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return;

    const audioCtx = new Ctor();
    audioCtxRef.current = audioCtx;
    void audioCtx.resume().catch(() => {});

    let source: MediaStreamAudioSourceNode;
    try {
      source = audioCtx.createMediaStreamSource(stream);
    } catch {
      // Stream went stale between getUserMedia and effect — bail quietly.
      void audioCtx.close().catch(() => {});
      return;
    }
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    const binSize = Math.max(1, Math.floor(data.length / bars));

    const tick = () => {
      analyser.getByteFrequencyData(data);
      const heights = heightsRef.current;
      for (let i = 0; i < bars; i++) {
        let sum = 0;
        const start = i * binSize;
        for (let j = 0; j < binSize; j++) sum += data[start + j] ?? 0;
        const avg = sum / binSize; // 0–255
        const target = MIN_PCT + (avg / 255) * (MAX_PCT - MIN_PCT);
        heights[i] = heights[i] * SMOOTHING + target * (1 - SMOOTHING);
      }
      paint();
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      try {
        source.disconnect();
      } catch {
        /* already disconnected */
      }
      void audioCtx.close().catch(() => {});
      audioCtxRef.current = null;
    };
  }, [stream, bars]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={`flex h-full items-center justify-center gap-[3px] ${className}`}
    >
      {Array.from({ length: bars }, (_, i) => (
        <div
          key={i}
          className="w-[3px] rounded-full bg-accent/90"
          style={{ height: `${MIN_PCT}%` }}
        />
      ))}
    </div>
  );
}
