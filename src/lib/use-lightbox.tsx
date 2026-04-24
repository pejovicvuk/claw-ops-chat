"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export interface LightboxImage {
  src: string;
  alt?: string;
}

interface LightboxContextValue {
  open: (image: LightboxImage) => void;
  close: () => void;
  current: LightboxImage | null;
}

const LightboxContext = createContext<LightboxContextValue | null>(null);

export function LightboxProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<LightboxImage | null>(null);
  const open = useCallback((image: LightboxImage) => setCurrent(image), []);
  const close = useCallback(() => setCurrent(null), []);
  return (
    <LightboxContext.Provider value={{ open, close, current }}>{children}</LightboxContext.Provider>
  );
}

export function useLightbox(): LightboxContextValue {
  const ctx = useContext(LightboxContext);
  if (!ctx) {
    // Graceful fallback when no provider is mounted — opening just
    // becomes a no-op so preview components don't crash in isolation.
    return { open: () => {}, close: () => {}, current: null };
  }
  return ctx;
}
