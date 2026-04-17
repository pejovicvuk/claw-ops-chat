"use client";

import { useCallback, useEffect, useRef } from "react";
import { FiSettings, FiX, FiLogOut, FiArrowLeft } from "react-icons/fi";
import { authFetch, clearAuth } from "@/lib/auth";
import { clearAccessToken } from "@/lib/apiClient";
import { useUrlState } from "@/lib/use-url-state";
import { Z_INDEX } from "@/lib/z-index";
import { SettingsMainPage } from "./pages/settings-main-page";
import { SettingsConnectionsPage } from "./pages/settings-connections-page";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

type Page = "main" | "connections";

/** Parse the current settings page from the URL param value. */
function parsePage(raw: string | null): Page | null {
  if (raw === null) return null;
  if (raw === "connections") return "connections";
  // "main", "1" (back-compat), anything else → main page
  return "main";
}

const PAGE_TITLES: Record<Page, string> = {
  main: "Settings",
  connections: "Connections",
};

/**
 * Full-screen settings overlay. Open/closed state + active page are both
 * driven by the ?settings= URL param:
 *   ?settings=main        → main page
 *   ?settings=connections → connections list page
 *   absent                → closed
 *   ?settings=1           → treated as "main" (back-compat)
 */
export function SettingsOverlay() {
  const { params, setParam } = useUrlState();
  const page = parsePage(params.get("settings"));
  const open = page !== null;
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setParam("settings", null);
  }, [setParam]);

  const goToMain = useCallback(() => {
    setParam("settings", "main");
  }, [setParam]);

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

  const isSubPage = page !== "main";
  const title = PAGE_TITLES[page];

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[6px] sm:p-6"
      style={{ zIndex: Z_INDEX.MODAL }}
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <div
        className="animate-modal-in flex h-full w-full flex-col overflow-hidden border border-canvas-border bg-canvas-bg shadow-2xl sm:h-auto sm:max-h-[min(640px,85vh)] sm:w-[min(760px,calc(100vw-48px))] sm:max-w-none sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-canvas-border px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2">
            {isSubPage ? (
              <button
                type="button"
                onClick={goToMain}
                aria-label="Back to settings"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
              >
                <FiArrowLeft size={14} />
              </button>
            ) : (
              <FiSettings size={16} className="shrink-0 text-canvas-muted" />
            )}
            <h2 id="settings-title" className="truncate text-[14px] font-semibold text-canvas-fg">
              {title}
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
