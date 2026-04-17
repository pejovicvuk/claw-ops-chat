"use client";

import { useCallback, useEffect, useState } from "react";

export function useVisualViewport() {
  const [height, setHeight] = useState(() =>
    typeof window !== "undefined" ? (window.visualViewport?.height ?? window.innerHeight) : 800,
  );

  const update = useCallback(() => {
    const h = window.visualViewport?.height ?? window.innerHeight;
    setHeight(h);
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", update);
      vv.addEventListener("scroll", update);
      return () => {
        vv.removeEventListener("resize", update);
        vv.removeEventListener("scroll", update);
      };
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [update]);

  const keyboardHeight =
    typeof window !== "undefined" ? Math.max(0, window.innerHeight - height) : 0;

  return { viewportHeight: height, keyboardHeight, isKeyboardOpen: keyboardHeight > 100 };
}
