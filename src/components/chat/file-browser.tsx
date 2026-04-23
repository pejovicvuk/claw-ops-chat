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
  FiFilePlus,
  FiFolderPlus,
  FiRefreshCw,
  FiTrash2,
  FiUpload,
  FiUploadCloud,
  FiX,
} from "react-icons/fi";
import { List, type RowComponentProps } from "react-window";
import {
  createFolder,
  deleteFile,
  downloadFile,
  FileApiError,
  listFiles,
  writeFile,
} from "@/lib/api";
import { getCachedDir, invalidateDir, isCacheFresh, setCachedDir } from "@/lib/file-cache";
import { useExitAnimation } from "@/lib/use-exit-animation";
import { useToast } from "@/lib/use-toast";
import { uploadBatch, type BatchProgress, type UploadEntry } from "@/lib/batch-upload";
import type { FileEntry } from "@/lib/types";
import { Breadcrumbs } from "./file-browser/breadcrumbs";
import { DeleteConfirm } from "./file-browser/delete-confirm";
import { FileDropzone } from "./file-browser/file-dropzone";
import { FileRow } from "./file-browser/file-row";
import { FileToolbar, type SortState } from "./file-browser/file-toolbar";
import { NewItemDialog } from "./file-browser/new-item-dialog";

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
    if (err.code === "too_large") return err.message;
    if (err.status === 401) return "Still signing you back in — try again in a moment.";
    if (err.status === 403) return "Access denied for this path.";
    if (err.status === 409) return "Already exists.";
    if (err.status === 413) return err.message;
    return err.message;
  }
  return "Network error — check your connection.";
}

/** Convert a FileList into UploadEntry[], preserving webkitRelativePath when present. */
function fileListToEntries(list: FileList): UploadEntry[] {
  const out: UploadEntry[] = [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
    out.push({ file: f, relativePath: rel && rel.length > 0 ? rel : f.name });
  }
  return out;
}

type ContextMenuState =
  | { kind: "entry"; x: number; y: number; entry: FileEntry }
  | { kind: "empty"; x: number; y: number };

interface BatchUploadState {
  progress: BatchProgress;
  controller: AbortController;
}

export const FileBrowser = forwardRef<FileBrowserHandle, FileBrowserProps>(function FileBrowser(
  { onFileClick, onFileOpen, onCopyPath, initialPath, onPathChange },
  ref,
) {
  const { toast } = useToast();
  const [currentPath, setCurrentPath] = useState(initialPath || "~");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "name", dir: "asc" });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [confirm, setConfirm] = useState<{ entry: FileEntry; error?: string | null } | null>(null);
  const [newItem, setNewItem] = useState<{ kind: "file" | "folder" } | null>(null);
  const [batch, setBatch] = useState<BatchUploadState | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);

  // Retain last non-null popup payloads so exit animations can continue to
  // render after the open state flips back to null.
  const lastContextMenuRef = useRef(contextMenu);
  if (contextMenu) lastContextMenuRef.current = contextMenu;
  const lastConfirmRef = useRef(confirm);
  if (confirm) lastConfirmRef.current = confirm;
  const lastNewItemRef = useRef(newItem);
  if (newItem) lastNewItemRef.current = newItem;

  const { mounted: contextMenuMounted, state: contextMenuAnim } = useExitAnimation(
    contextMenu !== null,
    140,
  );
  const { mounted: confirmMounted, state: confirmAnim } = useExitAnimation(confirm !== null, 200);
  const { mounted: newItemMounted, state: newItemAnim } = useExitAnimation(newItem !== null, 200);

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
          // Stale-while-revalidate failed — keep showing cached content but
          // surface the error as a toast. The inline banner is gone.
          toast.error(mapError(err));
        }
      } finally {
        setLoading(false);
      }
    },
    [onPathChange, toast],
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

  const handleEntryContextMenu = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ kind: "entry", x: e.clientX, y: e.clientY, entry });
  }, []);

  const handleEmptyContextMenu = useCallback((e: React.MouseEvent) => {
    // Only fire when the click landed on the container itself, not on a row
    // (rows stopPropagation). Defensive: some browsers re-emit on parent when
    // a child handler is defined but doesn't preventDefault.
    if (e.target !== e.currentTarget) {
      // Still allow empty menu if click was on a list wrapper element (not a row)
      const el = e.target as HTMLElement;
      if (el.closest("[role='listitem']")) return;
    }
    e.preventDefault();
    setContextMenu({ kind: "empty", x: e.clientX, y: e.clientY });
  }, []);

  const closeMenu = useCallback(() => setContextMenu(null), []);

  /**
   * Upload a batch (flat file list OR nested folder) with aggregate progress.
   * Called from the dropzone, the Upload files button, and the Upload folder
   * button. Partial failures are reported in the final toast; the list
   * refreshes even on partial success.
   */
  const handleBatchUpload = useCallback(
    async (uploadEntries: UploadEntry[]) => {
      if (uploadEntries.length === 0) return;
      const controller = new AbortController();
      setBatch({
        controller,
        progress: {
          completedBytes: 0,
          totalBytes: uploadEntries.reduce((a, e) => a + e.file.size, 0),
          fraction: 0,
          currentFile: uploadEntries[0]?.relativePath ?? "",
          currentIndex: 1,
          total: uploadEntries.length,
        },
      });

      const result = await uploadBatch(currentPath, uploadEntries, {
        signal: controller.signal,
        onProgress: (p) => {
          setBatch((prev) => (prev ? { ...prev, progress: p } : prev));
        },
      });

      invalidateDir(currentPath);
      loadDir(currentPath, { bypassCache: true });
      setBatch(null);

      if (result.aborted) {
        toast.info("Upload cancelled");
        return;
      }
      if (result.failed.length === 0) {
        toast.success(
          result.succeeded === 1 ? "Uploaded 1 file" : `Uploaded ${result.succeeded} files`,
        );
      } else if (result.succeeded === 0) {
        toast.error(
          result.failed.length === 1
            ? `Upload failed: ${result.failed[0].error}`
            : `All ${result.failed.length} uploads failed`,
        );
      } else {
        toast.error(
          `Uploaded ${result.succeeded} of ${result.succeeded + result.failed.length} — ${result.failed.length} failed`,
        );
      }
    },
    [currentPath, loadDir, toast],
  );

  const triggerFileInput = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const triggerFolderInput = useCallback(() => {
    folderInputRef.current?.click();
  }, []);

  const handleInputUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files;
      if (!list || list.length === 0) return;
      const items = fileListToEntries(list);
      e.target.value = "";
      await handleBatchUpload(items);
    },
    [handleBatchUpload],
  );

  const confirmDelete = useCallback(
    async (entry: FileEntry) => {
      try {
        await deleteFile(entry.path, entry.directory);
        invalidateDir(currentPath);
        loadDir(currentPath, { bypassCache: true });
        setConfirm(null);
      } catch (err) {
        setConfirm((prev) => (prev ? { ...prev, error: mapError(err) } : prev));
      }
    },
    [currentPath, loadDir],
  );

  const handleCreateItem = useCallback(
    async (name: string) => {
      if (!newItem) return;
      if (newItem.kind === "folder") {
        await createFolder(currentPath, { name, recursive: false });
        toast.success(`Folder "${name}" created`);
      } else {
        // File creation: just write an empty body. Server-side rejects if the
        // parent doesn't exist; here the parent is always `currentPath`.
        const fullPath =
          currentPath === "~" ? `~/${name}` : `${currentPath.replace(/\/+$/, "")}/${name}`;
        await writeFile(fullPath, "");
        toast.success(`File "${name}" created`);
      }
      setNewItem(null);
      invalidateDir(currentPath);
      loadDir(currentPath, { bypassCache: true });
    },
    [currentPath, loadDir, newItem, toast],
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
            handleEntryContextMenu(e, entry);
          }}
        />
      </div>
    ),
    [handleEntryClick, handleEntryDoubleClick, handleEntryContextMenu],
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
  const batchPct = batch ? Math.round(batch.progress.fraction * 100) : 0;

  return (
    // The dropzone wraps the ENTIRE browser (breadcrumbs, toolbar, list).
    // Wrapping only the list area made the drop target too small — users
    // drag toward the panel header instinctively and landed outside the
    // listener, which is why "nothing happens" was the common report.
    <FileDropzone onUpload={handleBatchUpload} className="flex h-full flex-col outline-none">
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
        {/* Folder picker — the webkitdirectory attribute isn't modeled by
            the DOM types, so we add it via a ref callback. Same handler as
            the plain file input because `webkitRelativePath` is always
            populated when this attribute is present. */}
        <input
          ref={(el) => {
            folderInputRef.current = el;
            if (el) el.setAttribute("webkitdirectory", "");
          }}
          type="file"
          multiple
          className="hidden"
          onChange={handleInputUpload}
        />

        <div
          ref={listContainerRef}
          className="flex-1 min-h-0 overflow-y-auto"
          role="list"
          aria-label="Files and folders"
          aria-busy={loading}
          onContextMenu={handleEmptyContextMenu}
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

        {batch && (
          <div className="shrink-0 border-t border-canvas-border bg-canvas-surface/60 p-2">
            <div className="flex items-center gap-2 text-[11px]">
              <span className="min-w-0 flex-1 truncate text-canvas-fg">
                {batch.progress.total === 1
                  ? "Uploading"
                  : `Uploading ${batch.progress.currentIndex} of ${batch.progress.total}`}
                <span className="ml-1 text-canvas-muted" title={batch.progress.currentFile}>
                  — {batch.progress.currentFile}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-canvas-muted">{batchPct}%</span>
              <button
                type="button"
                onClick={() => batch.controller.abort()}
                aria-label="Cancel upload"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
              >
                <FiX size={10} />
              </button>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-canvas-border">
              <div
                className="h-full bg-accent transition-[width] duration-100"
                style={{ width: `${batchPct}%` }}
              />
            </div>
          </div>
        )}

        {contextMenuMounted &&
          lastContextMenuRef.current &&
          (() => {
            const menu = lastContextMenuRef.current;
            const menuAnimClass =
              contextMenuAnim === "exiting" ? "animate-menu-out" : "animate-menu-in";
            const baseItemClass =
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-canvas-fg hover:bg-canvas-surface-hover";

            if (menu.kind === "empty") {
              return (
                <div
                  className={`fixed rounded-md border border-canvas-border bg-canvas-bg py-1 shadow-lg ${menuAnimClass}`}
                  style={{ left: menu.x, top: menu.y, zIndex: 9999 }}
                  role="menu"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setNewItem({ kind: "file" });
                      closeMenu();
                    }}
                    className={baseItemClass}
                    role="menuitem"
                  >
                    <FiFilePlus size={12} />
                    New file…
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewItem({ kind: "folder" });
                      closeMenu();
                    }}
                    className={baseItemClass}
                    role="menuitem"
                  >
                    <FiFolderPlus size={12} />
                    New folder…
                  </button>
                  <div className="my-1 h-px bg-canvas-border" />
                  <button
                    type="button"
                    onClick={() => {
                      closeMenu();
                      triggerFileInput();
                    }}
                    className={baseItemClass}
                    role="menuitem"
                  >
                    <FiUpload size={12} />
                    Upload files…
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      closeMenu();
                      triggerFolderInput();
                    }}
                    className={baseItemClass}
                    role="menuitem"
                  >
                    <FiUploadCloud size={12} />
                    Upload folder…
                  </button>
                </div>
              );
            }

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
                    className={baseItemClass}
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
                    className={baseItemClass}
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
                        toast.error(mapError(err));
                      });
                      closeMenu();
                    }}
                    className={baseItemClass}
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

        {newItemMounted && lastNewItemRef.current && (
          <NewItemDialog
            kind={lastNewItemRef.current.kind}
            parentPath={currentPath}
            animationState={newItemAnim}
            onSubmit={handleCreateItem}
            onCancel={() => setNewItem(null)}
          />
        )}
      </div>
    </FileDropzone>
  );
});
