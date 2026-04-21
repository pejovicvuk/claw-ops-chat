"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useVisualViewport() {
  const [height, setHeight] = useState(() =>
    typeof window !== "undefined" ? (window.visualViewport?.height ?? window.innerHeight) : 800,
  );

  const rafRef = useRef<number | null>(null);

  const update = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setHeight(window.visualViewport?.height ?? window.innerHeight);
    });
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    const cleanup = () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    if (vv) {
      vv.addEventListener("resize", update);
      vv.addEventListener("scroll", update);
      return () => {
        vv.removeEventListener("resize", update);
        vv.removeEventListener("scroll", update);
        cleanup();
      };
    }
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      cleanup();
    };
  }, [update]);

  const keyboardHeight =
    typeof window !== "undefined" ? Math.max(0, window.innerHeight - height) : 0;

  return { viewportHeight: height, keyboardHeight, isKeyboardOpen: keyboardHeight > 100 };
}
