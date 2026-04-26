"use client";

import type { ReactNode } from "react";

interface SectionGridProps {
  children: ReactNode;
  minCardWidth?: number;
  className?: string;
}

export function SectionGrid({ children, minCardWidth = 220, className }: SectionGridProps) {
  return (
    <div
      className={`grid gap-3 ${className ?? ""}`}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${minCardWidth}px, 1fr))` }}
    >
      {children}
    </div>
  );
}
