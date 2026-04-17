"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { FiSettings, FiX, FiLogOut, FiMail, FiUser, FiShield } from "react-icons/fi";
import { authFetch, clearAuth, getUser } from "@/lib/auth";
import { clearAccessToken } from "@/lib/apiClient";
import { useUrlState } from "@/lib/use-url-state";
import { Z_INDEX } from "@/lib/z-index";
import { SettingsSection } from "./settings-section";
import { ThemeSelector } from "./theme-selector";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";
const emptySubscribe = () => () => {};

/**
 * Full-screen settings overlay. Open/closed state is driven by ?settings=1 in the URL.
 * Render this once near the root (e.g. from page.tsx) — it handles its own visibility.
 */
export function SettingsOverlay() {
  const { params, setParam } = useUrlState();
  const open = params.get("settings") === "1";
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Avoid hydration mismatch — returns false during SSR, true after mount.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  // Memo the user read to a stable identity — avoids infinite re-render loops
  // from useSyncExternalStore returning a fresh object each render.
  const user = useMemo(() => (mounted ? getUser() : null), [mounted]);

  const close = useCallback(() => {
    setParam("settings", null);
  }, [setParam]);

  // Escape key dismissal + focus trap entry point.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    // Focus close button when opening — gives keyboard users a predictable entry point
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

  if (!open) return null;

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
          <div className="flex items-center gap-2">
            <FiSettings size={16} className="text-canvas-muted" />
            <h2 id="settings-title" className="text-[14px] font-semibold text-canvas-fg">
              Settings
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={close}
            aria-label="Close settings"
            className="flex h-8 w-8 items-center justify-center rounded-full text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            <FiX size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {/* Account */}
          <SettingsSection title="Account" description="Signed in as">
            {user ? (
              <div className="space-y-2">
                <InfoRow icon={<FiMail size={13} />} label="Email" value={user.email} />
                {user.username && user.username !== user.email && (
                  <InfoRow icon={<FiUser size={13} />} label="Username" value={user.username} />
                )}
                {user.role && (
                  <InfoRow icon={<FiShield size={13} />} label="Role" value={user.role} />
                )}
              </div>
            ) : (
              <p className="text-[12px] text-canvas-muted">Not signed in</p>
            )}
          </SettingsSection>

          {/* Appearance */}
          <SettingsSection title="Appearance" description="Choose how the app looks">
            <ThemeSelector />
          </SettingsSection>

          {/* Connections (placeholder for future work) */}
          <SettingsSection title="Connections" description="External integrations">
            <p className="text-[12px] text-canvas-muted">
              GitHub, Claude Code, and other connections will appear here.
            </p>
          </SettingsSection>
        </div>

        {/* Footer */}
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
      </div>
    </div>
  );
}

interface InfoRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function InfoRow({ icon, label, value }: InfoRowProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-canvas-bg px-3 py-2">
      <span className="text-canvas-muted">{icon}</span>
      <span className="shrink-0 text-[11px] text-canvas-muted">{label}</span>
      <span className="ml-auto truncate text-[12px] font-medium text-canvas-fg">{value}</span>
    </div>
  );
}
