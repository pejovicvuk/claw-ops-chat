"use client";

import { useCallback, useEffect, useRef } from "react";

const DEFAULT_HOLD_MS = 500;
const MOVE_TOLERANCE_PX = 10;

export interface LongPressHandlers {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
}

export interface UseLongPressResult extends LongPressHandlers {
  /**
   * Wrap a click handler so it no-ops when the touch was a long press.
   * Use this on the same element's `onClick`.
   */
  guardClick: <T extends (...args: never[]) => unknown>(handler: T) => T;
}

interface UseLongPressOptions {
  ms?: number;
  /** Vibrate the device when the long-press fires (where supported). */
  vibrate?: boolean;
}

/**
 * Touch-friendly long-press handler. Mirrors the proven pattern from
 * `file-path-pill.tsx`: 500 ms hold fires `onLongPress` with the original
 * touch coords, finger drift > 10 px cancels the timer (so list scrolling
 * doesn't trigger the menu), and the immediately-following click is
 * suppressed so users don't accidentally activate the row.
 */
export function useLongPress(
  onLongPress: (touch: { x: number; y: number }) => void,
  opts: UseLongPressOptions = {},
): UseLongPressResult {
  const ms = opts.ms ?? DEFAULT_HOLD_MS;
  const vibrate = opts.vibrate !== false;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const handlerRef = useRef(onLongPress);
  useEffect(() => {
    handlerRef.current = onLongPress;
  }, [onLongPress]);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      firedRef.current = false;
      startRef.current = { x: touch.clientX, y: touch.clientY };
      timerRef.current = setTimeout(() => {
        firedRef.current = true;
        if (vibrate && typeof navigator !== "undefined" && "vibrate" in navigator) {
          try {
            navigator.vibrate(10);
          } catch {
            /* ignore */
          }
        }
        handlerRef.current({ x: touch.clientX, y: touch.clientY });
      }, ms);
    },
    [ms, vibrate],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const start = startRef.current;
      const touch = e.touches[0];
      if (!start || !touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (dx * dx + dy * dy > MOVE_TOLERANCE_PX * MOVE_TOLERANCE_PX) {
        cancel();
      }
    },
    [cancel],
  );

  const onTouchEnd = useCallback(() => {
    cancel();
  }, [cancel]);

  const onTouchCancel = useCallback(() => {
    cancel();
  }, [cancel]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const guardClick = useCallback(<T extends (...args: never[]) => unknown>(handler: T): T => {
    const wrapped = ((...args: Parameters<T>) => {
      if (firedRef.current) {
        firedRef.current = false;
        return undefined;
      }
      return handler(...args);
    }) as T;
    return wrapped;
  }, []);

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, guardClick };
}
