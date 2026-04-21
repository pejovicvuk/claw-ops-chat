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
import {
  FiAlertTriangle,
  FiCopy,
  FiDownload,
  FiFile,
  FiRefreshCw,
  FiTrash2,
  FiX,
} from "react-icons/fi";
import { List, type RowComponentProps } from "react-window";
import { deleteFile, downloadFile, FileApiError, listFiles, uploadFile } from "@/lib/api";
import { getCachedDir, invalidateDir, isCacheFresh, setCachedDir } from "@/lib/file-cache";
import { useExitAnimation } from "@/lib/use-exit-animation";
import type { FileEntry } from "@/lib/types";
import { Breadcrumbs } from "./file-browser/breadcrumbs";
import { DeleteConfirm } from "./file-browser/delete-confirm";
import { FileDropzone } from "./file-browser/file-dropzone";
import { FileRow } from "./file-browser/file-row";
import { FileToolbar, type SortState } from "./file-browser/file-toolbar";

export interface FileBrowserHandle {
  navigateTo: (path: string) => void;
}

interface FileBrowserProps {
  onFileClick?: (path: string) => void;
  onFileOpen?: (file: FileEntry) => void;
  onCopyPath?: (path: string) => void;
  hideRunOption?: boolean;
  /** Initial directory to show (defaults to "~"). */
  initialPath?: string;
  /** Called when the user navigates to a different directory. */
  onPathChange?: (path: string) => void;
}

const VIRTUALIZE_THRESHOLD = 500;
const ROW_HEIGHT = 36;

function mapError(err: unknown): string {
  if (err instanceof FileApiError) {
    if (err.code === "safe_path") return "That folder is outside the allowed workspace.";
    if (err.code === "folder_reject") return "Folders can't be uploaded — drop individual files.";
    if (err.code === "too_large") return err.message;
    if (err.status === 401) return "Still signing you back in — try again in a moment.";
    if (err.status === 403) return "Access denied for this path.";
    if (err.status === 413) return err.message;
    return err.message;
  }
  return "Network error — check your connection.";
}

interface UploadTask {
  id: string;
  name: string;
  size: number;
  progress: number;
  error?: string;
  done?: boolean;
  controller: AbortController;
}

function makeTaskId(): string {
  return `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const FileBrowser = forwardRef<FileBrowserHandle, FileBrowserProps>(function FileBrowser(
  { onFileClick, onFileOpen, onCopyPath, initialPath, onPathChange },
  ref,
) {
  const [currentPath, setCurrentPath] = useState(initialPath || "~");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "name", dir: "asc" });
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: FileEntry;
  } | null>(null);
  const [confirm, setConfirm] = useState<{ entry: FileEntry; error?: string | null } | null>(null);
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);

  // Retain last non-null popup payloads so exit animations can continue to
  // render after the open state flips back to null.
  const lastContextMenuRef = useRef(contextMenu);
  if (contextMenu) lastContextMenuRef.current = contextMenu;
  const lastConfirmRef = useRef(confirm);
  if (confirm) lastConfirmRef.current = confirm;

  const { mounted: contextMenuMounted, state: contextMenuAnim } = useExitAnimation(
    contextMenu !== null,
    140,
  );
  const { mounted: confirmMounted, state: confirmAnim } = useExitAnimation(confirm !== null, 200);

  const loadDir = useCallback(
    async (path: string, opts: { bypassCache?: boolean } = {}) => {
      setError(null);
      setQuery("");
      setSelectedIndex(-1);

      const cached = opts.bypassCache ? null : getCachedDir(path);
      if (cached) {
        setEntries(cached);
        setCurrentPath(path);
        onPathChange?.(path);
      }

      if (cached && !opts.bypassCache && isCacheFresh(path)) return;

      if (!cached) setLoading(true);

      try {
        const files = await listFiles(path);
        setEntries(files);
        setCurrentPath(path);
        onPathChange?.(path);
        setCachedDir(path, files);
      } catch (err) {
        if (!cached) {
          setEntries([]);
          setError(mapError(err));
        } else {
          setBanner(mapError(err));
        }
      } finally {
        setLoading(false);
      }
    },
    [onPathChange],
  );

  useImperativeHandle(ref, () => ({
    navigateTo: (path: string) => loadDir(path),
  }));

  useEffect(() => {
    loadDir(currentPath);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEntryClick = useCallback(
    (entry: FileEntry) => {
      if (entry.directory) {
        loadDir(entry.path);
      } else {
        onFileClick?.(entry.path);
      }
    },
    [loadDir, onFileClick],
  );

  const handleEntryDoubleClick = useCallback(
    (entry: FileEntry) => {
      if (!entry.directory) onFileOpen?.(entry);
    },
    [onFileOpen],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const closeMenu = useCallback(() => setContextMenu(null), []);

  /** Upload a batch with per-file progress tracking. */
  const handleDropUpload = useCallback(
    async (files: File[]) => {
      const tasks: UploadTask[] = files.map((file) => ({
        id: makeTaskId(),
        name: file.name,
        size: file.size,
        progress: 0,
        controller: new AbortController(),
      }));
      setUploads((prev) => [...prev, ...tasks]);

      await Promise.all(
        files.map(async (file, i) => {
          const task = tasks[i];
          try {
            await uploadFile(currentPath, file, {
              signal: task.controller.signal,
              onProgress: (fraction) => {
                setUploads((prev) =>
                  prev.map((t) => (t.id === task.id ? { ...t, progress: fraction } : t)),
                );
              },
            });
            setUploads((prev) =>
              prev.map((t) => (t.id === task.id ? { ...t, progress: 1, done: true } : t)),
            );
          } catch (err) {
            if ((err as Error)?.name === "AbortError") {
              setUploads((prev) => prev.filter((t) => t.id !== task.id));
              return;
            }
            setUploads((prev) =>
              prev.map((t) => (t.id === task.id ? { ...t, error: mapError(err), done: true } : t)),
            );
          }
        }),
      );

      // Always refetch — even on partial failures, something may have written.
      invalidateDir(currentPath);
      loadDir(currentPath, { bypassCache: true });

      // Auto-clear successful tasks after 3 s; failed ones stay until
      // the user dismisses them so errors aren't lost on mobile.
      setTimeout(() => {
        setUploads((prev) => prev.filter((t) => t.error));
      }, 3000);
    },
    [currentPath, loadDir],
  );

  const triggerFileInput = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleInputUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files;
      if (!list || list.length === 0) return;
      const files: File[] = [];
      for (let i = 0; i < list.length; i++) files.push(list[i]);
      await handleDropUpload(files);
      e.target.value = "";
    },
    [handleDropUpload],
  );

  const confirmDelete = useCallback(
    async (entry: FileEntry) => {
      try {
        await deleteFile(entry.path, entry.directory);
        invalidateDir(currentPath);
        loadDir(currentPath, { bypassCache: true });
        setConfirm(null);
        setBanner(null);
      } catch (err) {
        setConfirm((prev) => (prev ? { ...prev, error: mapError(err) } : prev));
      }
    },
    [currentPath, loadDir],
  );

  /** Derived filtered + sorted list. */
  const visibleEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : entries;
    return [...filtered].sort((a, b) => {
      if (a.directory !== b.directory) return a.directory ? -1 : 1;
      let cmp = 0;
      if (sort.key === "name") cmp = a.name.localeCompare(b.name);
      else if (sort.key === "size") cmp = (a.size ?? 0) - (b.size ?? 0);
      else if (sort.key === "mtime") cmp = (a.mtime ?? 0) - (b.mtime ?? 0);
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [entries, query, sort]);

  /** Clamp selection to list length when entries shrink/grow. */
  useEffect(() => {
    if (selectedIndex >= visibleEntries.length) setSelectedIndex(visibleEntries.length - 1);
  }, [selectedIndex, visibleEntries.length]);

  /** Parent directory path helper ("~" means already at root). */
  const parentOf = useCallback((path: string): string => {
    if (path === "~") return "~";
    const parts = path.split("/").filter(Boolean);
    if (parts.length <= 1) return "~";
    return "/" + parts.slice(0, -1).join("/");
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Don't intercept keys while a text input inside us has focus.
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(visibleEntries.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(0, (i < 0 ? 0 : i) - 1));
      } else if (e.key === "Enter") {
        const entry = visibleEntries[selectedIndex];
        if (!entry) return;
        e.preventDefault();
        if (entry.directory) loadDir(entry.path);
        else onFileOpen?.(entry);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        const parent = parentOf(currentPath);
        loadDir(parent);
      }
    },
    [visibleEntries, selectedIndex, loadDir, onFileOpen, parentOf, currentPath],
  );

  // Row renderer shared between virtualized and plain paths.
  const renderRow = useCallback(
    (entry: FileEntry, idx: number, style?: React.CSSProperties) => (
      <div key={entry.path} style={style} role="listitem">
        <FileRow
          entry={entry}
          onClick={() => {
            setSelectedIndex(idx);
            handleEntryClick(entry);
          }}
          onDoubleClick={() => handleEntryDoubleClick(entry)}
          onContextMenu={(e) => {
            setSelectedIndex(idx);
            handleContextMenu(e, entry);
          }}
        />
      </div>
    ),
    [handleEntryClick, handleEntryDoubleClick, handleContextMenu],
  );

  // Virtualized row — react-window v2 passes `index` + `style` + our rowProps.
  const VirtualRow = useCallback(
    ({ index, style }: RowComponentProps<Record<string, never>>) => {
      const entry = visibleEntries[index];
      if (!entry) return null;
      return renderRow(entry, index, style);
    },
    [visibleEntries, renderRow],
  );

  const shouldVirtualize = visibleEntries.length >= VIRTUALIZE_THRESHOLD;

  return (
    // The dropzone wraps the ENTIRE browser (breadcrumbs, toolbar, list).
    // Wrapping only the list area made the drop target too small — users
    // drag toward the panel header instinctively and landed outside the
    // listener, which is why "nothing happens" was the common report.
    <FileDropzone onUpload={handleDropUpload} className="flex h-full flex-col outline-none">
      <div
        className="flex h-full flex-col outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onClick={() => contextMenu && closeMenu()}
      >
        <Breadcrumbs path={currentPath} onNavigate={loadDir} />
        <FileToolbar
          key={currentPath}
          query={query}
          onQueryChange={setQuery}
          sort={sort}
          onSortChange={setSort}
          onUpload={triggerFileInput}
          onRefresh={() => {
            invalidateDir(currentPath);
            loadDir(currentPath, { bypassCache: true });
          }}
          loading={loading}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleInputUpload}
        />

        {banner && (
          <div className="flex items-start gap-2 border-b border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
            <FiAlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1">{banner}</span>
            <button
              type="button"
              onClick={() => setBanner(null)}
              aria-label="Dismiss"
              className="shrink-0 rounded text-red-300/80 hover:text-red-300"
            >
              <FiX size={11} />
            </button>
          </div>
        )}

        <div
          ref={listContainerRef}
          className="flex-1 min-h-0 overflow-y-auto"
          role="list"
          aria-label="Files and folders"
          aria-busy={loading}
        >
          {loading && !error && entries.length === 0 && (
            <div className="space-y-1.5 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-7 animate-pulse rounded-md bg-canvas-surface"
                  style={{ animationDelay: `${i * 60}ms` }}
                  aria-hidden
                />
              ))}
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-col items-center gap-2 px-4 py-8">
              <FiAlertTriangle size={18} className="text-red-400" />
              <p className="text-center text-[12px] text-red-400">{error}</p>
              <button
                type="button"
                onClick={() => loadDir(currentPath, { bypassCache: true })}
                className="flex items-center gap-1 text-[11px] text-blue-400 hover:underline"
              >
                <FiRefreshCw size={10} />
                Retry
              </button>
            </div>
          )}

          {!loading && !error && entries.length === 0 && (
            <p className="py-8 text-center text-[12px] text-canvas-muted">Empty directory</p>
          )}

          {!loading && !error && entries.length > 0 && visibleEntries.length === 0 && (
            <p className="py-8 text-center text-[12px] text-canvas-muted">
              No matches for &ldquo;{query}&rdquo;
            </p>
          )}

          {!error && !shouldVirtualize && visibleEntries.map((entry, idx) => renderRow(entry, idx))}

          {!error && shouldVirtualize && (
            <List
              rowCount={visibleEntries.length}
              rowHeight={ROW_HEIGHT}
              rowComponent={VirtualRow}
              rowProps={{}}
              overscanCount={8}
              defaultHeight={600}
              className="!h-full"
            />
          )}
        </div>

        {uploads.length > 0 && (
          <div className="max-h-40 shrink-0 overflow-y-auto border-t border-canvas-border bg-canvas-surface/60 p-2">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-canvas-muted">
              Uploads ({uploads.length})
            </p>
            <ul className="space-y-1">
              {uploads.map((task) => (
                <li
                  key={task.id}
                  className="flex items-center gap-2 rounded-md bg-canvas-bg px-2 py-1 text-[11px]"
                >
                  <span className="min-w-0 flex-1 truncate text-canvas-fg" title={task.name}>
                    {task.name}
                  </span>
                  {task.error ? (
                    <span className="shrink-0 text-red-400">{task.error}</span>
                  ) : task.done ? (
                    <span className="shrink-0 text-green-400">Done</span>
                  ) : (
                    <>
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-canvas-border">
                        <div
                          className="h-full bg-accent transition-[width]"
                          style={{ width: `${Math.round(task.progress * 100)}%` }}
                        />
                      </div>
                      <span className="shrink-0 tabular-nums text-canvas-muted">
                        {Math.round(task.progress * 100)}%
                      </span>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (!task.done) task.controller.abort();
                      setUploads((prev) => prev.filter((t) => t.id !== task.id));
                    }}
                    aria-label={task.done ? "Dismiss" : "Cancel upload"}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
                  >
                    <FiX size={10} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {contextMenuMounted &&
          lastContextMenuRef.current &&
          (() => {
            const menu = lastContextMenuRef.current;
            const menuAnimClass =
              contextMenuAnim === "exiting" ? "animate-menu-out" : "animate-menu-in";
            return (
              <div
                className={`fixed rounded-md border border-canvas-border bg-canvas-bg py-1 shadow-lg ${menuAnimClass}`}
                style={{ left: menu.x, top: menu.y, zIndex: 9999 }}
                role="menu"
                onClick={(e) => e.stopPropagation()}
              >
                {!menu.entry.directory && (
                  <button
                    type="button"
                    onClick={() => {
                      onFileOpen?.(menu.entry);
                      closeMenu();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-canvas-fg hover:bg-canvas-surface-hover"
                    role="menuitem"
                  >
                    <FiFile size={12} />
                    Open
                  </button>
                )}
                {onCopyPath && (
                  <button
                    type="button"
                    onClick={() => {
                      onCopyPath(menu.entry.path);
                      closeMenu();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-canvas-fg hover:bg-canvas-surface-hover"
                    role="menuitem"
                  >
                    <FiCopy size={12} />
                    Copy path
                  </button>
                )}
                {!menu.entry.directory && (
                  <button
                    type="button"
                    onClick={() => {
                      downloadFile(menu.entry.path).catch((err) => {
                        setBanner(mapError(err));
                      });
                      closeMenu();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-canvas-fg hover:bg-canvas-surface-hover"
                    role="menuitem"
                  >
                    <FiDownload size={12} />
                    Download
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setConfirm({ entry: menu.entry, error: null });
                    closeMenu();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-red-400 hover:bg-canvas-surface-hover"
                  role="menuitem"
                >
                  <FiTrash2 size={12} />
                  Delete
                </button>
              </div>
            );
          })()}

        {confirmMounted && lastConfirmRef.current && (
          <DeleteConfirm
            entry={lastConfirmRef.current.entry}
            error={lastConfirmRef.current.error}
            animationState={confirmAnim}
            onConfirm={() => {
              const c = lastConfirmRef.current;
              if (c) void confirmDelete(c.entry);
            }}
            onCancel={() => setConfirm(null)}
          />
        )}
      </div>
    </FileDropzone>
  );
});
