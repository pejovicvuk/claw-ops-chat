"use client";

import { useCallback, useEffect, useRef } from "react";
import { FiSettings, FiX, FiLogOut, FiArrowLeft } from "react-icons/fi";
import { authFetch, clearAuth } from "@/lib/auth";
import { clearAccessToken } from "@/lib/apiClient";
import { useUrlState } from "@/lib/use-url-state";
import { useExitAnimation } from "@/lib/use-exit-animation";
import { Z_INDEX } from "@/lib/z-index";
import { SettingsMainPage } from "./pages/settings-main-page";
import { SettingsConnectionsPage } from "./pages/settings-connections-page";
import { SettingsClaudePage } from "./pages/settings-claude-page";
import { SettingsGooglePage } from "./pages/settings-google-page";
import { SettingsMicrosoftPage } from "./pages/settings-microsoft-page";
import { SettingsGithubPage } from "./pages/settings-github-page";
import { SettingsAtlassianPage } from "./pages/settings-atlassian-page";
import { SettingsSlackPage } from "./pages/settings-slack-page";
import { SettingsLinearPage } from "./pages/settings-linear-page";
import { SettingsNotionPage } from "./pages/settings-notion-page";
import { SettingsTrelloPage } from "./pages/settings-trello-page";
import { SettingsTerminalPage } from "./pages/settings-terminal-page";
import { SettingsAgentPage } from "./pages/settings-agent-page";
import { SettingsAgentSkillsPage } from "./pages/settings-agent-skills-page";
import { SettingsAgentSubagentsPage } from "./pages/settings-agent-subagents-page";
import { SettingsNotificationsPage } from "./pages/settings-notifications-page";
import { SettingsVoicePage } from "./pages/settings-voice-page";
import { SettingsMemoryPage } from "./pages/settings-memory-page";
import { SettingsMemoryProjectPage } from "./pages/settings-memory-project-page";
import { SettingsMonitoringPage } from "@/components/monitoring/settings-monitoring-page";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

type PageKey =
  | "main"
  | "connections"
  | "connections/claude"
  | "connections/google"
  | "connections/microsoft"
  | "connections/github"
  | "connections/atlassian"
  | "connections/slack"
  | "connections/linear"
  | "connections/notion"
  | "connections/trello"
  | "agent"
  | "agent/skills"
  | "agent/subagents"
  | "terminal"
  | "notifications"
  | "voice"
  | "monitoring"
  | "memory";

interface PageInfo {
  /** Display title in the overlay header. */
  title: string;
  /** Where the back arrow goes. `null` = no back arrow (main page). */
  parent: PageKey | null;
  /** If true, use a wider/taller modal (useful for the terminal). */
  wide?: boolean;
}

const PAGES: Record<PageKey, PageInfo> = {
  main: { title: "Settings", parent: null },
  connections: { title: "Connections", parent: "main" },
  "connections/claude": { title: "Claude Code", parent: "connections" },
  "connections/google": { title: "Google Workspace", parent: "connections" },
  "connections/microsoft": { title: "Microsoft 365", parent: "connections" },
  "connections/github": { title: "GitHub", parent: "connections" },
  "connections/atlassian": { title: "Atlassian", parent: "connections" },
  "connections/slack": { title: "Slack", parent: "connections" },
  "connections/linear": { title: "Linear", parent: "connections" },
  "connections/notion": { title: "Notion", parent: "connections" },
  "connections/trello": { title: "Trello", parent: "connections" },
  agent: { title: "Agent", parent: "main" },
  "agent/skills": { title: "Skills", parent: "agent" },
  "agent/subagents": { title: "Subagents", parent: "agent" },
  terminal: { title: "Terminal", parent: "main", wide: true },
  notifications: { title: "Notifications", parent: "main" },
  voice: { title: "Voice input", parent: "main" },
  monitoring: { title: "Monitoring", parent: "main", wide: true },
  memory: { title: "Memory", parent: "main" },
};

/**
 * Settings URL strings of the form `memory/<projectSlug>` are valid drill-ins
 * to a per-project memory page; everything before the first slash maps to
 * an entry in `PAGES`. The slug is project-validated server-side.
 */
const MEMORY_PROJECT_PREFIX = "memory/";

/**
 * Parse the current settings page from the URL param value.
 * Returns null when the overlay should be closed.
 */
function parsePage(raw: string | null): PageKey | null {
  if (raw === null) return null;
  // Back-compat: "1" was the original open flag.
  if (raw === "1") return "main";
  // Back-compat: the standalone audit page used to live at ?settings=audit.
  // It was folded into the Monitoring overlay; redirect old links there.
  if (raw === "audit") return "monitoring";
  // Back-compat: Bitbucket and Jira sub-pages were unified into Atlassian.
  if (raw === "connections/bitbucket" || raw === "connections/jira") {
    return "connections/atlassian";
  }
  // Back-compat: Phase 2 of Memory absorbed the System Prompt + Rules sub-pages.
  // Their content was migrated into /root/.memory/global/ and is now editable
  // from the Memory page.
  if (raw === "agent/system-prompt" || raw === "agent/rules") {
    return "memory";
  }
  if (raw in PAGES) return raw as PageKey;
  // Dynamic per-project memory drill-in: still rendered by the Memory page.
  if (raw.startsWith(MEMORY_PROJECT_PREFIX)) return "memory";
  // Unknown page → fall back to main (rather than close).
  return "main";
}

/** Extract the project slug from a `memory/<slug>` URL value. */
function parseMemoryProjectSlug(raw: string | null): string | null {
  if (raw === null || !raw.startsWith(MEMORY_PROJECT_PREFIX)) return null;
  return raw.slice(MEMORY_PROJECT_PREFIX.length);
}

/**
 * Full-screen settings overlay. Open/closed state + active page are driven
 * by the ?settings= URL param. Supports nested paths like "connections/claude".
 */
export function SettingsOverlay() {
  const { params, setParam } = useUrlState();
  const rawPage = params.get("settings");
  const page = parsePage(rawPage);
  const memoryProjectSlug = parseMemoryProjectSlug(rawPage);
  const open = page !== null;
  const { mounted, state } = useExitAnimation(open, 200);
  const exiting = state === "exiting";
  // While exiting the URL has already lost ?settings=, so `page` flips to null
  // — keep the last seen page around so we can render the same content during
  // the exit animation rather than blanking the modal mid-fade.
  const lastPageRef = useRef<PageKey | null>(page);
  if (page !== null) lastPageRef.current = page;
  const renderPage = page ?? lastPageRef.current;
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setParam("settings", null);
  }, [setParam]);

  const goBack = useCallback(() => {
    if (!page) return;
    // Drill-back from a per-project memory page goes to the Memory landing,
    // not all the way to Settings → Main.
    if (memoryProjectSlug) {
      setParam("settings", "memory");
      return;
    }
    const parent = PAGES[page].parent;
    setParam("settings", parent ?? null);
  }, [memoryProjectSlug, page, setParam]);

  // Escape key dismissal + focus entry point on open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    closeButtonRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const handleLogout = useCallback(async () => {
    try {
      await authFetch(`${BASE}/api/auth/session`, { method: "DELETE" });
    } catch {
      /* ignore network errors — still want to clear local state */
    }
    clearAuth();
    clearAccessToken();
    window.location.href = `${BASE}/login`;
  }, []);

  if (!mounted || !renderPage) return null;

  const info = PAGES[renderPage];
  // The Memory landing's parent is "main"; drill-in adds a logical layer
  // back to "memory" but the static `info.parent` doesn't capture that, so
  // hasBack must also be true when we're on a project drill-in.
  const hasBack = info.parent !== null || memoryProjectSlug !== null;
  const wide = info.wide === true;
  const modalEnter = exiting ? "animate-modal-out" : "animate-modal-in";
  const modalClasses = wide
    ? `${modalEnter} flex h-full w-full flex-col overflow-hidden border border-canvas-border bg-canvas-bg shadow-2xl sm:h-auto sm:max-h-[min(800px,90vh)] sm:w-[min(960px,calc(100vw-48px))] sm:max-w-none sm:rounded-2xl`
    : `${modalEnter} flex h-full w-full flex-col overflow-hidden border border-canvas-border bg-canvas-bg shadow-2xl sm:h-auto sm:max-h-[min(640px,85vh)] sm:w-[min(760px,calc(100vw-48px))] sm:max-w-none sm:rounded-2xl`;

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[6px] sm:p-6 ${exiting ? "animate-backdrop-out" : "animate-backdrop-in"}`}
      style={{ zIndex: Z_INDEX.MODAL }}
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <div className={modalClasses} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-canvas-border px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2">
            {hasBack ? (
              <button
                type="button"
                onClick={goBack}
                aria-label="Back"
                className="tx-surface flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
              >
                <FiArrowLeft size={14} />
              </button>
            ) : (
              <FiSettings size={16} className="shrink-0 text-canvas-muted" />
            )}
            <h2 id="settings-title" className="truncate text-[14px] font-semibold text-canvas-fg">
              {info.title}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={close}
            aria-label="Close settings"
            className="tx-surface flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            <FiX size={16} />
          </button>
        </div>

        {/* Page content. Keyed by renderPage (+ memoryProjectSlug for the
            per-project drill-in) so React fully remounts the subtree on
            navigation — that replays animate-subpage-in for a soft opacity
            cross-fade instead of a hard content swap. Settings pages are
            lightweight and use cached fetches, so remount cost is
            negligible. */}
        <div
          key={`${renderPage}${memoryProjectSlug ? `:${memoryProjectSlug}` : ""}`}
          className="animate-subpage-in flex-1 overflow-y-auto px-5 py-5"
        >
          {renderPage === "main" && <SettingsMainPage />}
          {renderPage === "connections" && <SettingsConnectionsPage />}
          {renderPage === "connections/claude" && <SettingsClaudePage />}
          {renderPage === "connections/google" && <SettingsGooglePage />}
          {renderPage === "connections/microsoft" && <SettingsMicrosoftPage />}
          {renderPage === "connections/github" && <SettingsGithubPage />}
          {renderPage === "connections/atlassian" && <SettingsAtlassianPage />}
          {renderPage === "connections/slack" && <SettingsSlackPage />}
          {renderPage === "connections/linear" && <SettingsLinearPage />}
          {renderPage === "connections/notion" && <SettingsNotionPage />}
          {renderPage === "connections/trello" && <SettingsTrelloPage />}
          {renderPage === "agent" && <SettingsAgentPage />}
          {renderPage === "agent/skills" && <SettingsAgentSkillsPage />}
          {renderPage === "agent/subagents" && <SettingsAgentSubagentsPage />}
          {renderPage === "terminal" && <SettingsTerminalPage />}
          {renderPage === "notifications" && <SettingsNotificationsPage />}
          {renderPage === "voice" && <SettingsVoicePage />}
          {renderPage === "monitoring" && <SettingsMonitoringPage />}
          {renderPage === "memory" &&
            (memoryProjectSlug ? (
              <SettingsMemoryProjectPage slug={memoryProjectSlug} />
            ) : (
              <SettingsMemoryPage />
            ))}
        </div>

        {/* Footer — only on main page */}
        {renderPage === "main" && (
          <div
            className="flex shrink-0 items-center justify-end border-t border-canvas-border px-5 py-3"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)" }}
          >
            <button
              type="button"
              onClick={handleLogout}
              className="tx-surface flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] font-medium text-red-500 hover:bg-red-500/15"
            >
              <FiLogOut size={13} />
              Log out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
