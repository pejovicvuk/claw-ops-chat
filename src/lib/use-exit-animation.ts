"use client";

import { useEffect, useRef, useState } from "react";

export type ExitAnimationState = "entering" | "open" | "exiting";

/**
 * Keeps a component mounted for `exitMs` after `open` flips to false, so an
 * exit animation can play. Returns `{ mounted, state }` — unmount when
 * `!mounted`; drive classes off `state`.
 *
 * Zero-dependency replacement for `<AnimatePresence>` — keeps the animation
 * vocabulary CSS-only.
 */
export function useExitAnimation(open: boolean, exitMs = 150) {
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState<ExitAnimationState>(open ? "open" : "exiting");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The setState calls below deliberately sync React state with the `open`
  // prop across a scheduled timer — the canonical shape for animation-aware
  // mounting. Disabling the lint rule is correct here.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setMounted(true);
      setState("entering");
      const raf = requestAnimationFrame(() => setState("open"));
      return () => cancelAnimationFrame(raf);
    }
    setState("exiting");
    timerRef.current = setTimeout(() => {
      setMounted(false);
      timerRef.current = null;
    }, exitMs);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [open, exitMs]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return { mounted, state };
}
