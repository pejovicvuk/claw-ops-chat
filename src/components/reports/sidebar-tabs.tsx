"use client";

export type SidebarMode = "chats" | "reports";

interface SidebarTabsProps {
  mode: SidebarMode;
  onChange: (mode: SidebarMode) => void;
  unreadReports: number;
}

/**
 * Segmented Chats/Reports toggle that replaces the static "Chats" label
 * at the top of the sidebar. Uses inline styles for the active-segment
 * background so the Tailwind JIT can't purge dynamically-built classes —
 * same defensive pattern SessionList uses for its status indicators.
 */
export function SidebarTabs({ mode, onChange, unreadReports }: SidebarTabsProps) {
  return (
    <div className="inline-flex items-center rounded-lg bg-canvas-surface-hover p-0.5">
      <SegmentButton active={mode === "chats"} onClick={() => onChange("chats")}>
        Chats
      </SegmentButton>
      <SegmentButton active={mode === "reports"} onClick={() => onChange("reports")}>
        <span className="inline-flex items-center gap-1.5">
          Reports
          {unreadReports > 0 && (
            <span
              className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-semibold leading-none"
              style={{ backgroundColor: "var(--accent)", color: "white" }}
              aria-label={`${unreadReports} unread`}
            >
              {unreadReports > 99 ? "99+" : unreadReports}
            </span>
          )}
        </span>
      </SegmentButton>
    </div>
  );
}

function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`btn-press rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
        active ? "text-canvas-fg" : "text-canvas-muted hover:text-canvas-fg"
      }`}
      style={
        active
          ? { backgroundColor: "var(--canvas-bg)", boxShadow: "0 1px 2px rgba(0,0,0,0.08)" }
          : {}
      }
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
