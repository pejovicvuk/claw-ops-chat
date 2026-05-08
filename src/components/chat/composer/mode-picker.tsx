"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FiChevronDown, FiShield } from "react-icons/fi";
import { MODE_LABELS, MODE_OPTIONS, type ModeValue } from "./composer-constants";

interface ModePickerProps {
  /** The current permission mode (a `ModeValue` string at runtime, but we
   *  accept the broader `string` because the source state in
   *  `useClaudeChat` is typed loosely as `string`). */
  value: string;
  /** Called with the new mode when the user picks a row. */
  onChange: (next: ModeValue) => void;
  /** When true, render only the icon + chevron (mobile / narrow). */
  compact?: boolean;
}

/**
 * Composer-row pill that opens an upward-anchored popover listing the
 * four permission modes (Default / Accept Edits / Plan / Auto). Each
 * row carries a one-line description so the user doesn't have to
 * remember what each mode does.
 *
 * Outside-click dismissal mirrors the pattern used in
 * `header-indicators.tsx` (mousedown on document, scoped to the wrapper
 * via a ref) — the popover only installs the global listener while it's
 * open so background sessions don't keep one mounted.
 */
export function ModePicker({ value, onChange, compact }: ModePickerProps): ReactNode {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const label = MODE_LABELS[value as ModeValue] ?? "Default";

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Permission mode: ${label}`}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`btn-press flex items-center gap-1.5 rounded-full text-canvas-fg transition-colors duration-150 hover:bg-canvas-surface-hover ${
          compact ? "h-8 w-8 justify-center" : "h-8 px-2.5 text-[12px] font-medium"
        }`}
      >
        <FiShield size={13} />
        {!compact && (
          <>
            <span>{label}</span>
            <FiChevronDown size={12} className="text-canvas-muted" />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="animate-modal-in absolute bottom-full left-0 z-50 mb-2 w-[260px] rounded-xl border border-canvas-border bg-canvas-bg py-1 shadow-xl"
        >
          {MODE_OPTIONS.map((opt) => {
            const isActive = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => {
                  if (opt.value !== value) onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex w-full items-start gap-2 px-3.5 py-2.5 text-left transition-colors duration-150 hover:bg-canvas-surface-hover ${
                  isActive ? "bg-canvas-surface-hover" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-canvas-fg">{opt.label}</p>
                  <p className="text-[11px] text-canvas-muted">{opt.description}</p>
                </div>
                {isActive && <span className="mt-1 text-accent">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
