"use client";

import type { ReactNode } from "react";
import { useMemo, useSyncExternalStore } from "react";
import { FiMail, FiUser, FiShield, FiLink, FiChevronRight } from "react-icons/fi";
import { getUser } from "@/lib/auth";
import { useUrlState } from "@/lib/use-url-state";
import { SettingsSection } from "../settings-section";
import { ThemeSelector } from "../theme-selector";

const emptySubscribe = () => () => {};

/**
 * Main settings page — Account info, Appearance (theme), and a link to Connections.
 * Rendered inside <SettingsOverlay>; the overlay provides the header/footer chrome.
 */
export function SettingsMainPage() {
  const { setParam } = useUrlState();

  // Avoid hydration mismatch — returns false during SSR, true after mount.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  // Memo the user read to a stable identity — avoids infinite re-render loops
  // from useSyncExternalStore returning a fresh object each render.
  const user = useMemo(() => (mounted ? getUser() : null), [mounted]);

  return (
    <div className="space-y-4">
      {/* Account */}
      <SettingsSection title="Account" description="Signed in as">
        {user ? (
          <div className="space-y-2">
            <InfoRow icon={<FiMail size={13} />} label="Email" value={user.email} />
            {user.username && user.username !== user.email && (
              <InfoRow icon={<FiUser size={13} />} label="Username" value={user.username} />
            )}
            {user.role && <InfoRow icon={<FiShield size={13} />} label="Role" value={user.role} />}
          </div>
        ) : (
          <p className="text-[12px] text-canvas-muted">Not signed in</p>
        )}
      </SettingsSection>

      {/* Appearance */}
      <SettingsSection title="Appearance" description="Choose how the app looks">
        <ThemeSelector />
      </SettingsSection>

      {/* Connections — link to sub-page */}
      <SettingsSection title="Connections" description="External integrations">
        <button
          type="button"
          onClick={() => setParam("settings", "connections")}
          className="flex w-full items-center gap-3 rounded-xl border border-canvas-border bg-canvas-bg px-4 py-3 text-left transition-colors hover:bg-canvas-surface-hover"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-canvas-surface text-canvas-fg">
            <FiLink size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-canvas-fg">Manage connections</p>
            <p className="mt-0.5 text-[11px] text-canvas-muted">
              Claude Code, GitHub, Bitbucket, Gmail, Outlook
            </p>
          </div>
          <FiChevronRight size={14} className="shrink-0 text-canvas-muted" />
        </button>
      </SettingsSection>
    </div>
  );
}

interface InfoRowProps {
  icon: ReactNode;
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
