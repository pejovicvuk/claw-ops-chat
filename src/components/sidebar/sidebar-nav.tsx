"use client";

import type { ReactNode } from "react";
import { FiBarChart2, FiCpu, FiFolder, FiMessageSquare, FiPlus } from "react-icons/fi";

/**
 * Section keys used by the sidebar nav.
 *
 * `null` (no key) is the implicit "in a conversation" state — when the
 * user is reading or sending a chat (no `?view=`), no nav row is
 * highlighted. The five explicit values map 1:1 to a `?view=` param.
 */
export type NavSection = "projects" | "reports" | "agents" | "chats";

interface SidebarNavProps {
  /** The section currently rendered in the main pane, or `null` while
   *  the user is reading a conversation (no nav row highlighted). */
  active: NavSection | null;
  /** Fires when the "+ New" row is clicked — same affordance as the old
   *  "+" button: starts a fresh chat and routes back to the chat view. */
  onNew: () => void;
  /** Fires for any of the section rows. The parent owns the URL change
   *  so it can also close the mobile drawer when appropriate. */
  onNavigate: (section: NavSection) => void;
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
 * One row of the sidebar nav. Plain stroke icon + medium-weight label,
 * Claude-style — no outlined-circle wrapper around the icon. The
 * row's hover / active background is the only visual chrome.
 */
function NavRow({ icon, label, active, badge, onClick }: NavRowProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`focus-ring btn-press flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
        active
          ? "bg-canvas-surface-hover text-canvas-fg"
          : "text-canvas-fg hover:bg-canvas-surface-hover/60"
      }`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-canvas-muted">
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
 * Vertical icon + label navigation. Claude-style: plain stroke icons
 * (no circle wrapper), medium-weight labels, soft hover/active rows.
 */
export function SidebarNav({
  active,
  onNew,
  onNavigate,
  unreadReports,
}: SidebarNavProps): ReactNode {
  return (
    <nav className="flex flex-col gap-0.5 px-2 py-2" aria-label="Main">
      <NavRow icon={<FiPlus size={16} strokeWidth={2.25} />} label="New chat" onClick={onNew} />
      <NavRow
        icon={<FiFolder size={16} />}
        label="Projects"
        active={active === "projects"}
        onClick={() => onNavigate("projects")}
      />
      <NavRow
        icon={<FiBarChart2 size={16} />}
        label="Reports"
        active={active === "reports"}
        badge={unreadReports}
        onClick={() => onNavigate("reports")}
      />
      <NavRow
        icon={<FiCpu size={16} />}
        label="Agents"
        active={active === "agents"}
        onClick={() => onNavigate("agents")}
      />
      <NavRow
        icon={<FiMessageSquare size={16} />}
        label="Chats"
        active={active === "chats"}
        onClick={() => onNavigate("chats")}
      />
    </nav>
  );
}
