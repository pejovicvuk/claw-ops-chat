"use client";

import type { ReactNode } from "react";

interface SettingsSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

/**
 * Reusable section wrapper for the settings overlay.
 * Renders a titled card with optional subtitle and arbitrary content.
 */
export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <section className="rounded-xl border border-canvas-border bg-canvas-surface p-4">
      <header className="mb-3">
        <h3 className="text-[13px] font-semibold text-canvas-fg">{title}</h3>
        {description && <p className="mt-0.5 text-[11px] text-canvas-muted">{description}</p>}
      </header>
      <div>{children}</div>
    </section>
  );
}
