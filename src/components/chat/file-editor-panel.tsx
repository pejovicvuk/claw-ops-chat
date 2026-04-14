"use client";

import { useCallback, useEffect, useState } from "react";
import { FiX, FiSave } from "react-icons/fi";
import { readFile, writeFile } from "@/lib/api";
import type { FileEntry } from "@/lib/types";

interface FileEditorPanelProps {
  file: FileEntry;
  onClose: () => void;
  zIndex?: number;
  onFocus?: () => void;
}

export function FileEditorPanel({ file, onClose, zIndex = 50, onFocus }: FileEditorPanelProps) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    readFile(file.path)
      .then((c) => {
        setContent(c);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [file.path]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await writeFile(file.path, content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [file.path, content]);

  return (
    <div
      className="fixed right-4 top-16 flex flex-col rounded-lg border border-canvas-border bg-canvas-bg shadow-xl"
      style={{ zIndex, width: 500, height: 400 }}
      onClick={onFocus}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-canvas-border px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-canvas-fg">
          {file.name}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex h-6 w-6 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            <FiSave size={12} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            <FiX size={12} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {loading && (
          <div className="flex h-full items-center justify-center">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-canvas-border border-t-canvas-muted" />
          </div>
        )}
        {error && (
          <div className="p-4 text-[12px] text-red-400">{error}</div>
        )}
        {!loading && !error && (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="h-full w-full resize-none bg-canvas-bg p-3 font-mono text-[12px] leading-relaxed text-canvas-fg focus:outline-none"
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}
