"use client";

import type { SnapResult } from "@/lib/canvas/snap-zones";

interface SnapOverlayProps {
  /** The active snap target, or null when no zone is suggested. */
  snap: SnapResult | null;
  zIndex: number;
}

/**
 * Translucent accent rectangle that previews where a window will land
 * if the drag is released right now. Smoothly transitions x/y/w/h so
 * moving between zones glides instead of teleporting.
 */
export function SnapOverlay({ snap, zIndex }: SnapOverlayProps) {
  if (!snap) return null;
  const { geometry } = snap;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute rounded-xl border-2 transition-all duration-100 ease-out"
      style={{
        left: geometry.x,
        top: geometry.y,
        width: geometry.w,
        height: geometry.h,
        zIndex,
        backgroundColor: "color-mix(in srgb, var(--accent) 14%, transparent)",
        borderColor: "var(--accent)",
        boxShadow: "0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent) inset",
      }}
    />
  );
}
