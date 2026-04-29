"use client";

import { useEffect, useRef } from "react";
import { FiMessageSquare } from "react-icons/fi";
import type { WindowKind } from "./canvas-types";

interface AddWindowMenuProps {
  onPick: (kind: WindowKind) => void;
  onDismiss: () => void;
}

/**
 * Small dropdown listing the addable window kinds. Currently only
 * `chat`; the muted "More types coming soon" footer makes the
 * extensibility intent visible without leaving an empty list.
 *
 * Closes on Esc or any pointerdown outside the menu.
 */
export function AddWindowMenu({ onPick, onDismiss }: AddWindowMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    };
    const onClick = (e: PointerEvent) => {
      if (!ref.current) return;
      if (e.target instanceof Node && ref.current.contains(e.target)) return;
      onDismiss();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onClick);
    };
  }, [onDismiss]);

  return (
    <div
      ref={ref}
      role="menu"
      className="absolute right-0 top-full z-10 mt-1.5 w-56 overflow-hidden rounded-lg border border-canvas-border bg-canvas-bg shadow-xl"
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => onPick("chat")}
        className="row-hover focus-ring flex w-full items-center gap-2.5 px-3 py-2 text-left text-canvas-fg hover:bg-canvas-surface-hover"
      >
        <FiMessageSquare size={13} className="text-canvas-muted" />
        <span className="flex-1">
          <span className="block text-[13px] font-medium">Chat</span>
          <span className="block text-[11px] text-canvas-muted">
            Claude session scoped to this item
          </span>
        </span>
      </button>
      <div className="border-t border-canvas-border px-3 py-2 text-[10px] uppercase tracking-wider text-canvas-muted">
        More types coming soon
      </div>
    </div>
  );
}
