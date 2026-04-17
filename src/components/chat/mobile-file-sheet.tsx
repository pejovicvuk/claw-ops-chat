"use client";

import { useEffect } from "react";
import { FiX } from "react-icons/fi";
import { FileBrowser } from "./file-browser";
import { Z_INDEX } from "@/lib/z-index";
import type { FileEntry } from "@/lib/types";

interface MobileFileSheetProps {
  open: boolean;
  onClose: () => void;
  onCopyPath?: (path: string) => void;
  onFileOpen?: (file: FileEntry) => void;
}

export function MobileFileSheet({ open, onClose, onCopyPath, onFileOpen }: MobileFileSheetProps) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-[2px]"
        style={{ zIndex: Z_INDEX.MODAL }}
        onClick={onClose}
      />
      <div
        className="animate-sheet-up fixed inset-x-0 bottom-0 flex flex-col rounded-t-2xl border-t border-canvas-border bg-canvas-bg shadow-xl"
        style={{ zIndex: Z_INDEX.MODAL + 1, maxHeight: "75dvh" }}
      >
        <div className="flex justify-center py-2">
          <div className="h-1 w-8 rounded-full bg-canvas-muted/30" />
        </div>
        <div className="flex items-center justify-between px-4 pb-2">
          <span className="text-[13px] font-semibold text-canvas-fg">Files</span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            <FiX size={15} />
          </button>
        </div>
        <div className="file-panel-fill min-h-0 flex-1">
          <FileBrowser onFileClick={onCopyPath} onFileOpen={onFileOpen} />
        </div>
      </div>
    </>
  );
}
