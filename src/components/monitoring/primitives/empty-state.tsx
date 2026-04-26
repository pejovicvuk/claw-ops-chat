"use client";

import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  variant?: "info" | "warning" | "celebratory";
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = "info",
}: EmptyStateProps) {
  const ringClass =
    variant === "warning"
      ? "ring-[var(--mon-warning)]/20 bg-[var(--mon-warning)]/5"
      : variant === "celebratory"
        ? "ring-[var(--mon-healthy)]/20 bg-[var(--mon-healthy)]/5"
        : "ring-canvas-border bg-canvas-bg";
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl px-6 py-10 text-center ring-1 ${ringClass}`}
    >
      {icon ? <div className="mb-3 text-canvas-muted">{icon}</div> : null}
      <h3 className="text-[14px] font-medium text-canvas-fg">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-md text-[12px] text-canvas-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
