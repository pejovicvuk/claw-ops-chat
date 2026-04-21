"use client";

import { useCallback, useEffect, useRef } from "react";
import { FiSettings, FiX, FiLogOut, FiArrowLeft } from "react-icons/fi";
import { authFetch, clearAuth } from "@/lib/auth";
import { clearAccessToken } from "@/lib/apiClient";
import { useUrlState } from "@/lib/use-url-state";
import { Z_INDEX } from "@/lib/z-index";
import { SettingsMainPage } from "./pages/settings-main-page";
import { SettingsConnectionsPage } from "./pages/settings-connections-page";
import { SettingsClaudePage } from "./pages/settings-claude-page";
import { SettingsGooglePage } from "./pages/settings-google-page";
import { SettingsMicrosoftPage } from "./pages/settings-microsoft-page";
import { SettingsGithubPage } from "./pages/settings-github-page";
import { SettingsBitbucketPage } from "./pages/settings-bitbucket-page";
import { SettingsSlackPage } from "./pages/settings-slack-page";
import { SettingsLinearPage } from "./pages/settings-linear-page";
import { SettingsJiraPage } from "./pages/settings-jira-page";
import { SettingsNotionPage } from "./pages/settings-notion-page";
import { SettingsTerminalPage } from "./pages/settings-terminal-page";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

type PageKey =
  | "main"
  | "connections"
  | "connections/claude"
  | "connections/google"
  | "connections/microsoft"
  | "connections/github"
  | "connections/bitbucket"
  | "connections/slack"
  | "connections/linear"
  | "connections/jira"
  | "connections/notion"
  | "terminal";

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
  "connections/bitbucket": { title: "Bitbucket", parent: "connections" },
  "connections/slack": { title: "Slack", parent: "connections" },
  "connections/linear": { title: "Linear", parent: "connections" },
  "connections/jira": { title: "Jira", parent: "connections" },
  "connections/notion": { title: "Notion", parent: "connections" },
  terminal: { title: "Terminal", parent: "main", wide: true },
};

/**
 * Parse the current settings page from the URL param value.
 * Returns null when the overlay should be closed.
 */
function parsePage(raw: string | null): PageKey | null {
  if (raw === null) return null;
  // Back-compat: "1" was the original open flag.
  if (raw === "1") return "main";
  if (raw in PAGES) return raw as PageKey;
  // Unknown page → fall back to main (rather than close).
  return "main";
}

/**
 * Full-screen settings overlay. Open/closed state + active page are driven
 * by the ?settings= URL param. Supports nested paths like "connections/claude".
 */
export function SettingsOverlay() {
  const { params, setParam } = useUrlState();
  const page = parsePage(params.get("settings"));
  const open = page !== null;
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setParam("settings", null);
  }, [setParam]);

  const goBack = useCallback(() => {
    if (!page) return;
    const parent = PAGES[page].parent;
    setParam("settings", parent ?? null);
  }, [page, setParam]);

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

  if (!open || !page) return null;

  const info = PAGES[page];
  const hasBack = info.parent !== null;
  const wide = info.wide === true;
  const modalClasses = wide
    ? "animate-modal-in flex h-full w-full flex-col overflow-hidden border border-canvas-border bg-canvas-bg shadow-2xl sm:h-auto sm:max-h-[min(800px,90vh)] sm:w-[min(960px,calc(100vw-48px))] sm:max-w-none sm:rounded-2xl"
    : "animate-modal-in flex h-full w-full flex-col overflow-hidden border border-canvas-border bg-canvas-bg shadow-2xl sm:h-auto sm:max-h-[min(640px,85vh)] sm:w-[min(760px,calc(100vw-48px))] sm:max-w-none sm:rounded-2xl";

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[6px] sm:p-6"
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
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
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
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            <FiX size={16} />
          </button>
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {page === "main" && <SettingsMainPage />}
          {page === "connections" && <SettingsConnectionsPage />}
          {page === "connections/claude" && <SettingsClaudePage />}
          {page === "connections/google" && <SettingsGooglePage />}
          {page === "connections/microsoft" && <SettingsMicrosoftPage />}
          {page === "connections/github" && <SettingsGithubPage />}
          {page === "connections/bitbucket" && <SettingsBitbucketPage />}
          {page === "connections/slack" && <SettingsSlackPage />}
          {page === "connections/linear" && <SettingsLinearPage />}
          {page === "connections/jira" && <SettingsJiraPage />}
          {page === "connections/notion" && <SettingsNotionPage />}
          {page === "terminal" && <SettingsTerminalPage />}
        </div>

        {/* Footer — only on main page */}
        {page === "main" && (
          <div
            className="flex shrink-0 items-center justify-end border-t border-canvas-border px-5 py-3"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)" }}
          >
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] font-medium text-red-500 transition-colors hover:bg-red-500/15"
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
