"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { FiX } from "react-icons/fi";
import type { MonStatus } from "@/lib/monitoring/types";
import { StatusBadge } from "./status-badge";

interface DetailDrawerTab {
  key: string;
  label: string;
  badge?: number | string;
}

interface DetailDrawerProps {
  title: string;
  subtitle?: string;
  status?: MonStatus;
  tabs?: DetailDrawerTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
}

export function DetailDrawer({
  title,
  subtitle,
  status,
  tabs,
  activeTab,
  onTabChange,
  onClose,
  actions,
  children,
}: DetailDrawerProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-drawer-title"
        className="animate-modal-in fixed right-0 top-0 z-50 flex h-full w-full max-w-[480px] flex-col border-l border-canvas-border bg-canvas-bg shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-canvas-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2
                id="detail-drawer-title"
                className="truncate text-[14px] font-semibold text-canvas-fg"
              >
                {title}
              </h2>
              {status ? <StatusBadge status={status} size="xs" /> : null}
            </div>
            {subtitle ? (
              <p className="mt-0.5 truncate text-[11px] text-canvas-muted">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            <FiX size={16} />
          </button>
        </header>
        {tabs && tabs.length > 0 ? (
          <nav
            role="tablist"
            className="flex shrink-0 gap-1 border-b border-canvas-border px-2 py-1"
          >
            {tabs.map((tab) => {
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onTabChange?.(tab.key)}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
                    active
                      ? "bg-canvas-surface-hover text-canvas-fg"
                      : "text-canvas-muted hover:text-canvas-fg"
                  }`}
                >
                  {tab.label}
                  {tab.badge !== undefined ? (
                    <span className="rounded bg-canvas-bg px-1.5 py-0.5 text-[10px] tabular-nums text-canvas-muted">
                      {tab.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {actions ? (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-canvas-border px-4 py-3">
            {actions}
          </footer>
        ) : null}
      </aside>
    </>
  );
}
