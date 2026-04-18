"use client";

import { FiX } from "react-icons/fi";
import { FileIcon } from "../file-browser/file-icon";
import type { FileEntry } from "@/lib/types";

interface EditorTab {
  key: string;
  file: FileEntry;
  dirty?: boolean;
}

interface EditorTabsProps {
  tabs: EditorTab[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
}

/**
 * Horizontal tab strip for the mobile editor sheet. Shows filename +
 * dirty dot, horizontally scrollable when many files are open.
 */
export function EditorTabs({ tabs, activeKey, onSelect, onClose }: EditorTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Open files"
      className="flex shrink-0 items-stretch gap-1 overflow-x-auto border-b border-canvas-border bg-canvas-surface px-1 py-1 no-scrollbar"
    >
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <div
            key={tab.key}
            role="tab"
            aria-selected={active}
            className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] ${
              active
                ? "bg-canvas-bg text-canvas-fg shadow-sm"
                : "text-canvas-muted hover:bg-canvas-surface-hover"
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(tab.key)}
              className="flex min-w-0 items-center gap-1.5"
            >
              <FileIcon entry={tab.file} size={12} />
              <span className="max-w-[160px] truncate">{tab.file.name}</span>
              {tab.dirty && (
                <span
                  aria-label="Unsaved changes"
                  className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-accent"
                />
              )}
            </button>
            <button
              type="button"
              onClick={() => onClose(tab.key)}
              aria-label={`Close ${tab.file.name}`}
              className="-mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
            >
              <FiX size={10} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
