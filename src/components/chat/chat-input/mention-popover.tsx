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
import { FiFolder, FiLoader, FiRefreshCw } from "react-icons/fi";
import { useFileListings } from "@/lib/use-file-listings";
import { useWorkspaceIndex, type WorkspaceIndexEntry } from "@/lib/use-workspace-index";
import { fuzzyRank } from "@/lib/fuzzy-score";
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
  /** True when the user has typed at least one `/` in the `@…` token.
   *  `false` → "global" search across the workspace index.
   *  `true`  → "scoped" list of `dirPart` contents. */
  hasSlash: boolean;
  /** Element to anchor the popover above. Typically the textarea. */
  anchorRef: React.RefObject<HTMLElement | null>;
  onAccept: (token: string, isDirectory: boolean) => void;
  onClose: () => void;
}

const MAX_VISIBLE = 8;

// Internal shape that unifies "scoped dir entry" and "workspace index
// entry" so the render loop doesn't branch per-item.
interface DisplayEntry {
  name: string;
  path: string;
  directory: boolean;
  /** For global-mode items: relative path (under `~`) used in the second
   *  line of the row. Empty for scoped-mode items. */
  secondary?: string;
}

function filterScoped(entries: FileEntry[], prefix: string): DisplayEntry[] {
  if (!prefix) {
    return entries.slice(0, MAX_VISIBLE * 4).map(toDisplay);
  }
  const p = prefix.toLowerCase();
  const starts: FileEntry[] = [];
  const contains: FileEntry[] = [];
  for (const e of entries) {
    const n = e.name.toLowerCase();
    if (n.startsWith(p)) starts.push(e);
    else if (n.includes(p)) contains.push(e);
  }
  return [...starts, ...contains].slice(0, 40).map(toDisplay);
}

function toDisplay(e: FileEntry): DisplayEntry {
  return { name: e.name, path: e.path, directory: e.directory };
}

/**
 * Rank the global index. When the query is empty, surface recently-
 * touched files at the top (by lastUpdated heuristic would be ideal —
 * we don't track mtime client-side, so alpha-sort of basenames is a
 * reasonable fallback).
 */
function rankGlobal(
  entries: WorkspaceIndexEntry[],
  rootResolved: string,
  prefix: string,
): DisplayEntry[] {
  // Filter to files only for global search — typing `@foo` with no slash
  // almost always means "attach/reference the file named foo", not
  // "navigate into a folder". The scoped mode handles directory drilling.
  const files = entries.filter((e) => !e.directory);
  if (!prefix) {
    const first = files.slice(0, 20);
    return first.map((e) => ({
      name: e.name,
      path: e.path,
      directory: false,
      secondary: relativeTo(rootResolved, e.path),
    }));
  }
  const ranked = fuzzyRank(files, prefix, (e) => `${relativeTo(rootResolved, e.path)}`, 20);
  return ranked.map(({ entry }) => ({
    name: entry.name,
    path: entry.path,
    directory: false,
    secondary: relativeTo(rootResolved, entry.path),
  }));
}

/** Turn an absolute path into a `~`-relative display string. */
function relativeTo(root: string, full: string): string {
  if (!root) return full;
  if (full === root) return "~";
  if (full.startsWith(root + "/") || full.startsWith(root + "\\")) {
    return `~/${full.slice(root.length + 1).replace(/\\/g, "/")}`;
  }
  return full;
}

/**
 * Build the replacement token for the outgoing text. Global-mode items
 * use the `~`-relative form; scoped items echo whatever `dirPart` the
 * user typed.
 *
 * Directories keep a trailing `/` so typing continues the drill-down.
 */
function buildToken(dirPart: string, mode: "global" | "scoped", entry: DisplayEntry): string {
  if (mode === "global") {
    const ref = entry.secondary && entry.secondary !== "~" ? entry.secondary : entry.name;
    return entry.directory ? `@${ref}/` : `@${ref}`;
  }
  const clean = dirPart === "~" ? "" : dirPart.replace(/\/+$/, "");
  const base = clean ? `${clean}/${entry.name}` : entry.name;
  return entry.directory ? `@${base}/` : `@${base}`;
}

export const MentionPopover = forwardRef<MentionPopoverHandle, MentionPopoverProps>(
  function MentionPopover(
    { open, dirPart, prefixPart, hasSlash, anchorRef, onAccept, onClose },
    ref,
  ) {
    const mode: "global" | "scoped" = hasSlash ? "scoped" : "global";

    // Scoped: list the one directory. Global: use the workspace index.
    const scoped = useFileListings(dirPart, { enabled: open && mode === "scoped" });
    const workspace = useWorkspaceIndex({ enabled: open && mode === "global" });

    const [selected, setSelected] = useState(0);
    const [pos, setPos] = useState<{ left: number; bottom: number; width: number } | null>(null);
    const listRef = useRef<HTMLUListElement>(null);

    // Derive the index root for "~"-relative path display. Heuristic: the
    // workspace index response includes `rootResolved`; we don't store it
    // in the hook today, but the first entry's path tells us the root by
    // trimming the shared prefix. Simpler: use the first directory entry
    // (the root itself isn't in the list). For now we just pass `""` and
    // strip later using the longest-common-prefix idea — actually simpler
    // to derive root from any entry by walking up until we run out of
    // ancestry shared with the others. Too fiddly. Use the fact that the
    // server guarantees paths start with the resolved root: take the
    // shortest path, that's the first direct child; its parent is the
    // root.
    const indexRoot = useMemo(() => {
      if (workspace.entries.length === 0) return "";
      // Find the shortest path — that's the topmost entry we indexed.
      let shortest = workspace.entries[0].path;
      for (let i = 1; i < workspace.entries.length; i++) {
        if (workspace.entries[i].path.length < shortest.length) {
          shortest = workspace.entries[i].path;
        }
      }
      // The root is the shortest's parent.
      const sepIdx = Math.max(shortest.lastIndexOf("/"), shortest.lastIndexOf("\\"));
      return sepIdx > 0 ? shortest.slice(0, sepIdx) : shortest;
    }, [workspace.entries]);

    const filtered = useMemo<DisplayEntry[]>(() => {
      if (mode === "scoped") return filterScoped(scoped.entries, prefixPart);
      return rankGlobal(workspace.entries, indexRoot, prefixPart);
    }, [mode, scoped.entries, workspace.entries, indexRoot, prefixPart]);

    const loading = mode === "scoped" ? scoped.loading : workspace.loading;

    // Reset selection to top whenever the filter or directory changes.
    useEffect(() => {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when upstream set changes
      setSelected(0);
    }, [mode, dirPart, prefixPart, filtered.length]);

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
        width: Math.min(480, r.width),
      });
    }, [open, anchorRef, dirPart, prefixPart, mode]);

    // Re-anchor on window resize / scroll.
    useEffect(() => {
      if (!open) return;
      const update = () => {
        const el = anchorRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setPos({
          left: r.left,
          bottom: Math.max(8, window.innerHeight - r.top + 8),
          width: Math.min(480, r.width),
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
      (entry: DisplayEntry) => {
        onAccept(buildToken(dirPart, mode, entry), entry.directory);
      },
      [dirPart, mode, onAccept],
    );

    useImperativeHandle(
      ref,
      () => ({
        handleKeyDown: (e) => {
          if (!open) return false;
          if (filtered.length === 0) {
            if (e.key === "Escape") {
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

    if (!open || !pos) return null;

    // Popover chrome is identical whether or not we have results — when
    // empty we render the header + an empty row so the user sees the
    // mention was recognized.
    return (
      <div
        role="listbox"
        aria-label="File suggestions"
        style={{ left: pos.left, bottom: pos.bottom, width: pos.width, position: "fixed" }}
        className="lg-menu z-50 overflow-hidden rounded-xl"
      >
        <PopoverHeader mode={mode} dirPart={dirPart} workspace={workspace} />
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-canvas-muted">
            {loading ? "Searching…" : prefixPart ? `No matches for "${prefixPart}"` : "No files"}
          </div>
        ) : (
          <ul
            ref={listRef}
            className="overflow-y-auto py-1"
            style={{ maxHeight: `${MAX_VISIBLE * 40}px` }}
          >
            {filtered.map((entry, idx) => (
              <li
                key={`${entry.path}:${idx}`}
                data-idx={idx}
                role="option"
                aria-selected={idx === selected}
              >
                <button
                  type="button"
                  // pointerDown fires before blur so the textarea keeps
                  // its caret position when the user taps a suggestion.
                  onPointerDown={(e) => {
                    e.preventDefault();
                    accept(entry);
                  }}
                  onMouseEnter={() => setSelected(idx)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${
                    idx === selected
                      ? "bg-canvas-surface-hover text-canvas-fg"
                      : "text-canvas-fg hover:bg-canvas-surface-hover"
                  }`}
                >
                  {entry.directory ? (
                    <FiFolder size={13} className="shrink-0 text-canvas-muted" />
                  ) : (
                    <FileIcon entry={{ ...entry, size: 0, mtime: 0 }} />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-[12px]">{entry.name}</span>
                    {entry.secondary && (
                      <span className="truncate text-[10px] text-canvas-muted">
                        {entry.secondary}
                      </span>
                    )}
                  </div>
                  {entry.directory && (
                    <span className="shrink-0 text-[10px] text-canvas-muted">/</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  },
);

interface PopoverHeaderProps {
  mode: "global" | "scoped";
  dirPart: string;
  workspace: ReturnType<typeof useWorkspaceIndex>;
}

function PopoverHeader({ mode, dirPart, workspace }: PopoverHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-canvas-border px-3 py-1 text-[10px] uppercase tracking-wide text-canvas-muted">
      {mode === "global" ? (
        <>
          <span className="truncate">
            All files
            {workspace.entries.length > 0 && (
              <span className="ml-1.5 normal-case tracking-normal text-canvas-muted/70">
                · {workspace.entries.length.toLocaleString()} indexed
                {workspace.truncated ? " (truncated)" : ""}
              </span>
            )}
          </span>
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              workspace.reload();
            }}
            aria-label="Refresh index"
            className="flex h-5 w-5 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            {workspace.loading ? (
              <FiLoader size={10} className="animate-spin" />
            ) : (
              <FiRefreshCw size={10} />
            )}
          </button>
        </>
      ) : (
        <>
          <span className="truncate">{dirPart}</span>
          {workspace.loading && <FiLoader size={10} className="animate-spin shrink-0" />}
        </>
      )}
    </div>
  );
}
