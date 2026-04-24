"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { FiX } from "react-icons/fi";
import { useLightbox } from "@/lib/use-lightbox";
import { Z_INDEX } from "@/lib/z-index";

/**
 * Fullscreen image viewer. Mounted once at the chat root (see
 * LightboxProvider in chat-layout). Backdrop/Esc/✕ all close.
 *
 * We let the browser handle pinch-zoom via touch-action: pinch-zoom —
 * no custom gesture lib to keep the bundle small.
 */
export function Lightbox() {
  const { current, close } = useLightbox();

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    // Lock body scroll while open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [current, close]);

  if (!current || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={current.alt || "Image viewer"}
      onClick={close}
      style={{ zIndex: Z_INDEX.MODAL + 10 }}
      className="animate-modal-in fixed inset-0 flex items-center justify-center bg-black/85 backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={close}
        aria-label="Close image"
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        style={{ top: "max(env(safe-area-inset-top, 0px), 16px)" }}
      >
        <FiX size={18} />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={current.src}
        alt={current.alt || ""}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] max-w-[96vw] select-none rounded object-contain shadow-2xl"
        style={{ touchAction: "pinch-zoom" }}
      />
    </div>,
    document.body,
  );
}
