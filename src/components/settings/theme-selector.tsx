"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { FiSun, FiMoon, FiMonitor } from "react-icons/fi";
import type { IconType } from "react-icons";

const emptySubscribe = () => () => {};

type ThemeOption = "light" | "dark" | "system";

const OPTIONS: { value: ThemeOption; label: string; Icon: IconType }[] = [
  { value: "light", label: "Light", Icon: FiSun },
  { value: "dark", label: "Dark", Icon: FiMoon },
  { value: "system", label: "System", Icon: FiMonitor },
];

/**
 * 3-way segmented control for theme selection (light / dark / system).
 * Uses next-themes under the hood.
 */
export function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  // Avoid hydration mismatch — returns false during SSR, true after mount.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  const active = mounted ? (theme as ThemeOption | undefined) : undefined;

  return (
    <div
      className="flex items-center gap-1 rounded-lg border border-canvas-border bg-canvas-bg p-1"
      role="radiogroup"
      aria-label="Theme"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const selected = active === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(value)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
              selected
                ? "bg-canvas-surface-hover text-canvas-fg"
                : "text-canvas-muted hover:text-canvas-fg"
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
