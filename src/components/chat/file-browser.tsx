"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { FiFolder, FiFile, FiChevronRight, FiDownload, FiTrash2, FiCopy } from "react-icons/fi";
import { listFiles, downloadFile, deleteFile, uploadFile } from "@/lib/api";
import type { FileEntry } from "@/lib/types";

export interface FileBrowserHandle {
  navigateTo: (path: string) => void;
}

interface FileBrowserProps {
  onFileClick?: (path: string) => void;
  onFileOpen?: (file: FileEntry) => void;
  onCopyPath?: (path: string) => void;
  hideRunOption?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} M`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} G`;
}

export const FileBrowser = forwardRef<FileBrowserHandle, FileBrowserProps>(function FileBrowser(
  { onFileClick, onFileOpen, onCopyPath },
  ref,
) {
  const [currentPath, setCurrentPath] = useState("~");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(
    null,
  );

  const loadDir = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const files = await listFiles(path);
      setEntries(files);
      setCurrentPath(path);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useImperativeHandle(ref, () => ({
    navigateTo: (path: string) => loadDir(path),
  }));

  useEffect(() => {
    loadDir(currentPath);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClick = (entry: FileEntry) => {
    if (entry.directory) {
      loadDir(entry.path);
    } else {
      onFileClick?.(entry.path);
    }
  };

  const handleDoubleClick = (entry: FileEntry) => {
    if (!entry.directory) {
      onFileOpen?.(entry);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const closeMenu = () => setContextMenu(null);

  // Breadcrumb segments
  const pathParts = currentPath.split("/").filter(Boolean);
  const breadcrumbs = pathParts.map((part, i) => ({
    label: part,
    path: "/" + pathParts.slice(0, i + 1).join("/"),
  }));

  // Handle drag-and-drop upload
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      for (let i = 0; i < files.length; i++) {
        await uploadFile(currentPath, files[i]);
      }
      loadDir(currentPath);
    },
    [currentPath, loadDir],
  );

  return (
    <div
      className="flex h-full flex-col"
      onClick={() => contextMenu && closeMenu()}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-canvas-border px-3 py-2 no-scrollbar">
        <button
          type="button"
          onClick={() => loadDir("~")}
          className="shrink-0 text-[11px] text-canvas-muted hover:text-canvas-fg"
        >
          ~
        </button>
        {breadcrumbs.map((crumb) => (
          <span key={crumb.path} className="flex items-center gap-1">
            <FiChevronRight size={10} className="text-canvas-muted/50" />
            <button
              type="button"
              onClick={() => loadDir(crumb.path)}
              className="shrink-0 text-[11px] text-canvas-muted hover:text-canvas-fg"
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-canvas-border border-t-canvas-muted" />
          </div>
        )}

        {!loading && entries.length === 0 && (
          <p className="py-8 text-center text-[12px] text-canvas-muted">Empty directory</p>
        )}

        {!loading &&
          entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => handleClick(entry)}
              onDoubleClick={() => handleDoubleClick(entry)}
              onContextMenu={(e) => handleContextMenu(e, entry)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-canvas-surface-hover"
            >
              {entry.directory ? (
                <FiFolder size={14} className="shrink-0 text-blue-400" />
              ) : (
                <FiFile size={14} className="shrink-0 text-canvas-muted" />
              )}
              <span className="min-w-0 flex-1 truncate text-[12px] text-canvas-fg">
                {entry.name}
              </span>
              {!entry.directory && (
                <span className="shrink-0 text-[10px] text-canvas-muted">
                  {formatSize(entry.size)}
                </span>
              )}
            </button>
          ))}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed rounded-md border border-canvas-border bg-canvas-bg py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y, zIndex: 9999 }}
        >
          {!contextMenu.entry.directory && (
            <button
              type="button"
              onClick={() => {
                onFileOpen?.(contextMenu.entry);
                closeMenu();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-canvas-fg hover:bg-canvas-surface-hover"
            >
              <FiFile size={12} />
              Open
            </button>
          )}
          {onCopyPath && (
            <button
              type="button"
              onClick={() => {
                onCopyPath(contextMenu.entry.path);
                closeMenu();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-canvas-fg hover:bg-canvas-surface-hover"
            >
              <FiCopy size={12} />
              Copy path
            </button>
          )}
          {!contextMenu.entry.directory && (
            <button
              type="button"
              onClick={() => {
                downloadFile(contextMenu.entry.path);
                closeMenu();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-canvas-fg hover:bg-canvas-surface-hover"
            >
              <FiDownload size={12} />
              Download
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              await deleteFile(contextMenu.entry.path);
              loadDir(currentPath);
              closeMenu();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-red-400 hover:bg-canvas-surface-hover"
          >
            <FiTrash2 size={12} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
});
