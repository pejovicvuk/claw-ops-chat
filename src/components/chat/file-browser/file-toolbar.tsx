"use client";

import { useEffect, useRef, useState } from "react";
import { FiArrowDown, FiArrowUp, FiRefreshCw, FiSearch, FiUpload, FiX } from "react-icons/fi";

export type SortKey = "name" | "size" | "mtime";
export type SortDir = "asc" | "desc";
export interface SortState {
  key: SortKey;
  dir: SortDir;
}

interface FileToolbarProps {
  query: string;
  onQueryChange: (query: string) => void;
  sort: SortState;
  onSortChange: (sort: SortState) => void;
  onUpload: () => void;
  onRefresh: () => void;
  loading: boolean;
}

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "size", label: "Size" },
  { key: "mtime", label: "Modified" },
];

export function FileToolbar({
  query,
  onQueryChange,
  sort,
  onSortChange,
  onUpload,
  onRefresh,
  loading,
}: FileToolbarProps) {
  // Initialize `local` from `query` at mount. The parent remounts this
  // component with a new `key` when the directory changes (and `query` is
  // reset to ""), so we never need to sync via effect. During typing, the
  // debounce below propagates the value up.
  const [local, setLocal] = useState(query);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Debounce typing → parent. 150ms feels instant on desktop, not too
  // eager on mobile where each keypress triggers onChange.
  useEffect(() => {
    const id = setTimeout(() => onQueryChange(local), 150);
    return () => clearTimeout(id);
  }, [local, onQueryChange]);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const currentLabel = SORT_OPTIONS.find((o) => o.key === sort.key)?.label ?? "Name";

  const setSortKey = (key: SortKey) => {
    if (sort.key === key) {
      onSortChange({ key, dir: sort.dir === "asc" ? "desc" : "asc" });
    } else {
      onSortChange({ key, dir: key === "name" ? "asc" : "desc" });
    }
    setMenuOpen(false);
  };

  return (
    <div className="flex items-center gap-1.5 border-b border-canvas-border px-2 py-1.5">
      <div className="relative flex min-w-0 flex-1 items-center">
        <FiSearch
          size={11}
          className="pointer-events-none absolute left-2 text-canvas-muted"
          aria-hidden
        />
        <input
          type="text"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          placeholder="Search in folder"
          aria-label="Search files in current folder"
          className="w-full rounded-md border border-transparent bg-canvas-surface pl-7 pr-7 py-1 text-[11px] text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none"
        />
        {local && (
          <button
            type="button"
            onClick={() => {
              setLocal("");
              onQueryChange("");
            }}
            aria-label="Clear search"
            className="absolute right-1.5 flex h-4 w-4 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            <FiX size={10} />
          </button>
        )}
      </div>

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex shrink-0 items-center gap-1 rounded-md border border-canvas-border px-1.5 py-1 text-[10px] text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
        >
          {currentLabel}
          {sort.dir === "asc" ? <FiArrowUp size={9} /> : <FiArrowDown size={9} />}
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full z-20 mt-1 min-w-[140px] overflow-hidden rounded-md border border-canvas-border bg-canvas-bg shadow-lg"
          >
            {SORT_OPTIONS.map((opt) => {
              const active = sort.key === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  role="menuitem"
                  onClick={() => setSortKey(opt.key)}
                  className={`flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[11px] hover:bg-canvas-surface-hover ${
                    active ? "text-canvas-fg" : "text-canvas-muted"
                  }`}
                >
                  <span>{opt.label}</span>
                  {active &&
                    (sort.dir === "asc" ? <FiArrowUp size={10} /> : <FiArrowDown size={10} />)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onUpload}
        aria-label="Upload files"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg sm:h-auto sm:w-auto sm:p-1.5"
      >
        <FiUpload className="text-[14px] sm:text-[12px]" />
      </button>
      <button
        type="button"
        onClick={onRefresh}
        aria-label="Refresh"
        disabled={loading}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:opacity-50 sm:h-auto sm:w-auto sm:p-1.5"
      >
        <FiRefreshCw className={`text-[14px] sm:text-[12px] ${loading ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}
