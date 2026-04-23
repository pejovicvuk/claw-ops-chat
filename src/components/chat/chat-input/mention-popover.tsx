"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { FiFolder, FiLoader } from "react-icons/fi";
import { useFileListings } from "@/lib/use-file-listings";
import type { FileEntry } from "@/lib/types";
import { FileIcon } from "../file-browser/file-icon";

export interface MentionPopoverHandle {
  /** Intercept a keydown event from the host textarea. Returns true when
      the popover consumed the key so the host can preventDefault. */
  handleKeyDown: (e: React.KeyboardEvent) => boolean;
}

interface MentionPopoverProps {
  open: boolean;
  dirPart: string;
  prefixPart: string;
  /** Element to anchor the popover above. Typically the textarea. */
  anchorRef: React.RefObject<HTMLElement | null>;
  onAccept: (token: string, isDirectory: boolean) => void;
  onClose: () => void;
}

const MAX_VISIBLE = 8;

function filterEntries(entries: FileEntry[], prefix: string): FileEntry[] {
  if (!prefix) return entries.slice(0, MAX_VISIBLE * 4);
  const p = prefix.toLowerCase();
  const starts: FileEntry[] = [];
  const contains: FileEntry[] = [];
  for (const e of entries) {
    const n = e.name.toLowerCase();
    if (n.startsWith(p)) starts.push(e);
    else if (n.includes(p)) contains.push(e);
  }
  return [...starts, ...contains];
}

/**
 * Build the replacement token for the outgoing text. Directories keep
 * trailing `/` so the user can keep typing into sub-dirs; files end
 * at the filename.
 *
 * `@` prefix is included here since the host replaces the whole
 * `[@ → caret]` range, including the `@` itself.
 */
function buildToken(dirPart: string, entry: FileEntry): string {
  // Normalize dirPart for display in the token. The listing returned
  // by the server is keyed off whatever the user typed (e.g. "~/src"),
  // which is what we want to echo back.
  const clean = dirPart === "~" ? "" : dirPart.replace(/\/+$/, "");
  const base = clean ? `${clean}/${entry.name}` : entry.name;
  return entry.directory ? `@${base}/` : `@${base}`;
}

export const MentionPopover = forwardRef<MentionPopoverHandle, MentionPopoverProps>(
  function MentionPopover({ open, dirPart, prefixPart, anchorRef, onAccept, onClose }, ref) {
    const { entries, loading } = useFileListings(dirPart, { enabled: open });
    const [selected, setSelected] = useState(0);
    const [pos, setPos] = useState<{ left: number; bottom: number; width: number } | null>(null);
    const listRef = useRef<HTMLUListElement>(null);

    const filtered = useMemo(
      () => filterEntries(entries, prefixPart).slice(0, 40),
      [entries, prefixPart],
    );

    // Reset selection to top whenever the filter or directory changes.
    useEffect(() => {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when upstream set changes
      setSelected(0);
    }, [dirPart, prefixPart, filtered.length]);

    // Anchor positioning: above the textarea, stretched to its width.
    useEffect(() => {
      const el = anchorRef.current;
      if (!open || !el) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- sync with DOM layout
        setPos(null);
        return;
      }
      const r = el.getBoundingClientRect();
       
      setPos({
        left: r.left,
        bottom: Math.max(8, window.innerHeight - r.top + 8),
        width: Math.min(420, r.width),
      });
    }, [open, anchorRef, dirPart, prefixPart]);

    // Re-anchor on window resize / scroll so the popover stays stuck to
    // the composer as the page reflows.
    useEffect(() => {
      if (!open) return;
      const update = () => {
        const el = anchorRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setPos({
          left: r.left,
          bottom: Math.max(8, window.innerHeight - r.top + 8),
          width: Math.min(420, r.width),
        });
      };
      window.addEventListener("resize", update);
      window.addEventListener("scroll", update, true);
      return () => {
        window.removeEventListener("resize", update);
        window.removeEventListener("scroll", update, true);
      };
    }, [open, anchorRef]);

    // Keep the selected item scrolled into view.
    useEffect(() => {
      const list = listRef.current;
      if (!list) return;
      const item = list.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
      if (item) item.scrollIntoView({ block: "nearest" });
    }, [selected]);

    const accept = useCallback(
      (entry: FileEntry) => {
        onAccept(buildToken(dirPart, entry), entry.directory);
      },
      [dirPart, onAccept],
    );

    useImperativeHandle(
      ref,
      () => ({
        handleKeyDown: (e) => {
          if (!open || filtered.length === 0) {
            if (open && e.key === "Escape") {
              onClose();
              return true;
            }
            return false;
          }
          switch (e.key) {
            case "ArrowDown":
              setSelected((i) => (i + 1) % filtered.length);
              return true;
            case "ArrowUp":
              setSelected((i) => (i - 1 + filtered.length) % filtered.length);
              return true;
            case "Enter":
            case "Tab": {
              const entry = filtered[selected];
              if (!entry) return false;
              accept(entry);
              return true;
            }
            case "Escape":
              onClose();
              return true;
            default:
              return false;
          }
        },
      }),
      [open, filtered, selected, accept, onClose],
    );

    if (!open || !pos || filtered.length === 0) {
      if (open && !loading && filtered.length === 0) {
        // Render an "empty" state instead of nothing — the user sees the
        // mention was recognized, just no matches.
        return pos ? (
          <div
            role="presentation"
            style={{ left: pos.left, bottom: pos.bottom, width: pos.width, position: "fixed" }}
            className="z-50 rounded-xl border border-canvas-border bg-canvas-bg px-3 py-2 text-[11px] text-canvas-muted shadow-xl"
          >
            No matches in <span className="text-canvas-fg">{dirPart}</span>
          </div>
        ) : null;
      }
      return null;
    }

    return (
      <div
        role="listbox"
        aria-label="File suggestions"
        style={{ left: pos.left, bottom: pos.bottom, width: pos.width, position: "fixed" }}
        className="z-50 overflow-hidden rounded-xl border border-canvas-border bg-canvas-bg shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-canvas-border px-3 py-1 text-[10px] uppercase tracking-wide text-canvas-muted">
          <span className="truncate">{dirPart}</span>
          {loading && <FiLoader size={10} className="animate-spin shrink-0" />}
        </div>
        <ul
          ref={listRef}
          className="max-h-[min(280px,40vh)] overflow-y-auto py-1"
          style={{ maxHeight: `${MAX_VISIBLE * 32 + 8}px` }}
        >
          {filtered.map((entry, idx) => (
            <li key={entry.path} data-idx={idx} role="option" aria-selected={idx === selected}>
              <button
                type="button"
                // Using pointerDown (fires before textarea blur) avoids the
                // caret jumping away when the user taps a suggestion.
                onPointerDown={(e) => {
                  e.preventDefault();
                  accept(entry);
                }}
                onMouseEnter={() => setSelected(idx)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] ${
                  idx === selected
                    ? "bg-canvas-surface-hover text-canvas-fg"
                    : "text-canvas-fg hover:bg-canvas-surface-hover"
                }`}
              >
                {entry.directory ? (
                  <FiFolder size={12} className="shrink-0 text-canvas-muted" />
                ) : (
                  <FileIcon entry={entry} />
                )}
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                {entry.directory && (
                  <span className="shrink-0 text-[10px] text-canvas-muted">/</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  },
);
