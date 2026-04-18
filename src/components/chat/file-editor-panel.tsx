"use client";

// Thin re-export — the real implementation now lives under ./file-editor/.
// Kept so existing imports (chat-layout.tsx) continue to resolve.
export { FileEditorPanel } from "./file-editor/editor-panel";
export type { FileEditorPanelProps } from "./file-editor/editor-panel";
