"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiCopy, FiDownload, FiEye, FiFile, FiFileText, FiImage, FiCode } from "react-icons/fi";
import { isImageExt } from "@/lib/mime";
import { Z_INDEX } from "@/lib/z-index";
import { useResolvePath } from "@/lib/use-resolve-path";
import { useReportChatFile } from "@/lib/chat-files-context";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

interface FilePathPillProps {
  path: string;
  /** When provided, clicking calls this instead of the default URL hash open. */
  onOpen?: (path: string) => void;
}

const CODE_EXT =
  /\.(ts|tsx|js|jsx|py|rs|go|java|kt|swift|rb|cpp?|h|sh|sql|html?|css|yaml?|toml|json|xml|md|mdx)$/i;

/**
 * Pick-and-render an icon based on the file's extension. Declared as a
 * regular component (instead of `const Icon = iconFor(path)` inside
 * render) to satisfy the React rule against creating components during
 * render — each render otherwise binds a fresh identifier to a stable
 * icon function, which lint treats as a new component identity.
 */
function FileIcon({ path, className }: { path: string; className?: string }) {
  if (isImageExt(path)) return <FiImage size={11} className={className} />;
  if (CODE_EXT.test(path)) return <FiCode size={11} className={className} />;
  if (/\.(txt|log|csv)$/i.test(path)) return <FiFileText size={11} className={className} />;
  return <FiFile size={11} className={className} />;
}

function basename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function openInEditor(path: string): void {
  try {
    const url = new URL(window.location.href);
    const current = url.searchParams.getAll("open");
    if (!current.includes(path)) {
      url.searchParams.append("open", path);
    }
    url.searchParams.set("active", path);
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  } catch {
    /* ignore */
  }
}

function triggerDownload(path: string): void {
  const href = `${BASE}/api/files/download?path=${encodeURIComponent(path)}`;
  const a = document.createElement("a");
  a.href = href;
  a.download = basename(path);
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Inline chip for a file path. Click opens the file in the floating
 * editor panel. Right-click (desktop) or long-press (mobile) shows a
 * context menu with Preview / Download / Copy path.
 */
export function FilePathPill({ path, onOpen }: FilePathPillProps) {
  // Anchored paths register themselves as "files referenced in this
  // chat" so subsequent ambiguous candidates (`helper.tsx`) can
  // disambiguate by directory affinity.
  useReportChatFile(path);

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  const open = useCallback(() => {
    if (onOpen) onOpen(path);
    else openInEditor(path);
  }, [path, onOpen]);

  const showMenu = useCallback((x: number, y: number) => {
    setMenu({ x, y });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const onClick = useCallback(() => {
    // Suppress the click that follows a long-press so users who held
    // the pill down don't accidentally open the file.
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    open();
  }, [open]);

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY);
    },
    [showMenu],
  );

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!e.touches[0]) return;
      const touch = e.touches[0];
      longPressFired.current = false;
      longPressTimer.current = setTimeout(() => {
        longPressFired.current = true;
        showMenu(touch.clientX, touch.clientY);
      }, 500);
    },
    [showMenu],
  );

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={onClick}
        onContextMenu={onContextMenu}
        onTouchStart={onTouchStart}
        onTouchEnd={cancelLongPress}
        onTouchMove={cancelLongPress}
        onTouchCancel={cancelLongPress}
        title={path}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-canvas-border bg-canvas-surface px-2 py-0.5 font-mono text-[11px] text-canvas-fg transition-colors hover:bg-canvas-surface-hover"
      >
        <FileIcon path={path} className="shrink-0 text-canvas-muted" />
        <span className="truncate">{basename(path)}</span>
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} path={path} onClose={closeMenu} onOpen={open} />}
    </>
  );
}

function ContextMenu({
  x,
  y,
  path,
  onClose,
  onOpen,
}: {
  x: number;
  y: number;
  path: string;
  onClose: () => void;
  onOpen: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  // Clamp to viewport so the menu doesn't spill off-screen on mobile.
  const left = Math.min(x, (typeof window !== "undefined" ? window.innerWidth : 800) - 180);
  const top = Math.min(y, (typeof window !== "undefined" ? window.innerHeight : 600) - 140);

  const copy = useCallback(() => {
    navigator.clipboard?.writeText(path).catch(() => {});
    onClose();
  }, [path, onClose]);

  const download = useCallback(() => {
    triggerDownload(path);
    onClose();
  }, [path, onClose]);

  const preview = useCallback(() => {
    onOpen();
    onClose();
  }, [onOpen, onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ zIndex: Z_INDEX.DROPDOWN, left, top }}
      className="animate-modal-in fixed min-w-[160px] overflow-hidden rounded-lg border border-canvas-border bg-canvas-bg shadow-lg"
    >
      <MenuItem icon={<FiEye size={12} />} label="Preview" onClick={preview} />
      <MenuItem icon={<FiDownload size={12} />} label="Download" onClick={download} />
      <MenuItem icon={<FiCopy size={12} />} label="Copy path" onClick={copy} />
    </div>,
    document.body,
  );
}

/**
 * Pill variant for bare/relative candidates the agent emits in prose
 * (e.g. `report.pdf`, `notes/draft.md`). Tries to resolve the candidate
 * against the workspace index; on success renders a regular `FilePathPill`
 * pointing at the resolved absolute path. On miss (no match or
 * ambiguous), falls back to the candidate text inline so the message
 * looks normal.
 */
export function ResolvedPathPill({ candidate }: { candidate: string }) {
  const { resolved } = useResolvePath(candidate);
  if (resolved) return <FilePathPill path={resolved} />;
  return <>{candidate}</>;
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex min-h-[36px] w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-canvas-fg transition-colors hover:bg-canvas-surface-hover"
    >
      <span className="text-canvas-muted">{icon}</span>
      {label}
    </button>
  );
}
