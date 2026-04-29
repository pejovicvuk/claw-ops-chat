"use client";

import { FiChevronRight, FiFolder } from "react-icons/fi";
import { SiGithub, SiBitbucket } from "react-icons/si";
import type { IntegrationStatus } from "@/lib/use-integration-status";

export type AddItemKind = "folder" | "github" | "bitbucket";

interface AddItemMenuProps {
  status: IntegrationStatus;
  onSelect: (kind: AddItemKind) => void;
}

/**
 * The three-row picker shown when the Add Item tray opens. Repo rows are
 * disabled with a "Connect first" hint when the matching integration
 * isn't configured — defense-in-depth complements the server-side 412.
 */
export function AddItemMenu({ status, onSelect }: AddItemMenuProps) {
  const githubReady = status.github.connected;
  const bitbucketReady = status.bitbucket.connected;
  const settingsHref = "?settings=connections";

  return (
    <div className="flex flex-col gap-0.5">
      <Row icon={<FiFolder size={14} />} label="New folder" onClick={() => onSelect("folder")} />
      <Row
        icon={<SiGithub size={14} />}
        label="Import from GitHub"
        secondary={
          githubReady
            ? status.github.login
              ? `signed in as ${status.github.login}`
              : "ready"
            : "Connect GitHub first"
        }
        disabled={!githubReady}
        disabledHint={settingsHref}
        onClick={() => onSelect("github")}
      />
      <Row
        icon={<SiBitbucket size={14} />}
        label="Import from Bitbucket"
        secondary={
          bitbucketReady
            ? status.bitbucket.displayName
              ? `signed in as ${status.bitbucket.displayName}`
              : "ready"
            : "Connect Bitbucket first"
        }
        disabled={!bitbucketReady}
        disabledHint={settingsHref}
        onClick={() => onSelect("bitbucket")}
      />
    </div>
  );
}

function Row({
  icon,
  label,
  secondary,
  disabled,
  disabledHint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  secondary?: string;
  disabled?: boolean;
  disabledHint?: string;
  onClick: () => void;
}) {
  if (disabled) {
    return (
      <div
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left opacity-60"
        title={disabledHint}
      >
        <span className="text-canvas-muted">{icon}</span>
        <span className="flex-1">
          <span className="block text-[13px] text-canvas-muted">{label}</span>
          {secondary && <span className="block text-[11px] text-canvas-muted">{secondary}</span>}
        </span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="row-hover focus-ring flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
    >
      <span>{icon}</span>
      <span className="flex-1">
        <span className="block text-[13px] text-canvas-fg">{label}</span>
        {secondary && <span className="block text-[11px] text-canvas-muted">{secondary}</span>}
      </span>
      <FiChevronRight size={13} className="text-canvas-muted" />
    </button>
  );
}
