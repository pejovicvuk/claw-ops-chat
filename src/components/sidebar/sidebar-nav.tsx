"use client";

import type { ReactNode } from "react";
import { FiBarChart2, FiCpu, FiFileText, FiFolder, FiPlus } from "react-icons/fi";

/**
 * Section keys used by the sidebar nav. "chats" is the implicit default
 * when none of the named sections is active — clicking the chat history
 * rows below the nav bar takes you there too, so it never has its own
 * nav button.
 */
export type NavSection = "chats" | "projects" | "reports" | "agents" | "documents";

interface SidebarNavProps {
  /** The section currently rendered in the main pane. */
  active: NavSection;
  /** Fires when the "+ New" row is clicked — same affordance as the old
   *  "+" button: starts a fresh chat and routes back to the chat view. */
  onNew: () => void;
  /** Fires for any of the section rows (Projects / Reports / Agents /
   *  Documents). The parent owns the URL change so it can also close the
   *  mobile drawer when appropriate. */
  onNavigate: (section: Exclude<NavSection, "chats">) => void;
  /** Optional unread count rendered on the Reports row. */
  unreadReports?: number;
}

interface NavRowProps {
  icon: ReactNode;
  label: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
}

/**
 * One row of the sidebar nav. The icon sits inside a thin-bordered
 * circle (Perplexity Comet styling); the label uses font-medium so it
 * reads as "slightly bolded" without crossing into semibold.
 */
function NavRow({ icon, label, active, badge, onClick }: NavRowProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`focus-ring btn-press flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors ${
        active
          ? "bg-canvas-surface-hover text-canvas-fg"
          : "text-canvas-fg hover:bg-canvas-surface-hover/60"
      }`}
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-canvas-fg"
        style={{ borderColor: "var(--canvas-border)" }}
      >
        {icon}
      </span>
      <span className="flex-1 truncate text-[14px] font-medium">{label}</span>
      {typeof badge === "number" && badge > 0 && (
        <span
          className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none"
          style={{ backgroundColor: "var(--accent)", color: "white" }}
          aria-label={`${badge} unread`}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

/**
 * Vertical icon-row navigation that replaces the old segmented Chats /
 * Reports / Projects tab strip. The visual reference is the Perplexity
 * Comet sidebar: outlined-circle icons + medium-weight labels.
 */
export function SidebarNav({
  active,
  onNew,
  onNavigate,
  unreadReports,
}: SidebarNavProps): ReactNode {
  return (
    <nav className="flex flex-col gap-0.5 px-2 py-2" aria-label="Main">
      <NavRow icon={<FiPlus size={15} strokeWidth={2.25} />} label="New" onClick={onNew} />
      <NavRow
        icon={<FiFolder size={14} />}
        label="Projects"
        active={active === "projects"}
        onClick={() => onNavigate("projects")}
      />
      <NavRow
        icon={<FiBarChart2 size={14} />}
        label="Reports"
        active={active === "reports"}
        badge={unreadReports}
        onClick={() => onNavigate("reports")}
      />
      <NavRow
        icon={<FiCpu size={14} />}
        label="Agents"
        active={active === "agents"}
        onClick={() => onNavigate("agents")}
      />
      <NavRow
        icon={<FiFileText size={14} />}
        label="Documents"
        active={active === "documents"}
        onClick={() => onNavigate("documents")}
      />
    </nav>
  );
}
