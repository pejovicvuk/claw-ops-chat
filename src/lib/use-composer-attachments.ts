"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createFolder, deleteFile, uploadFile, FileApiError } from "@/lib/api";
import { invalidateWorkspaceIndex } from "@/lib/use-workspace-index";
import type { AttachmentPillData } from "@/components/chat/chat-input/attachment-pill";
import { isImageName } from "@/components/chat/chat-input/attachment-pill";

/**
 * Per-turn attachment state for the chat composer.
 *
 * Extracted from `ChatInput` so that `ChatView` can own the state and feed
 * the same list from a panel-wide drop target (chat-area dropzone) AND the
 * in-composer paperclip button. Component-level dropzones all funnel
 * through `addFiles`.
 *
 * Runtime state includes the `AbortController` per attachment so ×-click
 * cancels in-flight XHRs. We stash the original `File` too so a future
 * "Retry" can re-submit without re-picking (not wired yet — kept for the
 * follow-up).
 */

export interface ComposerAttachment extends AttachmentPillData {
  controller: AbortController;
  /** Kept so future retry can re-submit without re-picking. */
  originalFile: File;
}

/** Public shape — strips controllers + File before crossing the UI boundary. */
export type ComposerAttachmentView = AttachmentPillData;

const UPLOADS_DIR = "~/uploads";

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function safeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function makeUploadName(file: File): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${ts}-${safeName(file.name) || "file"}`;
}

function errMsg(err: unknown): string {
  if (err instanceof FileApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Upload failed";
}

export interface UseComposerAttachmentsResult {
  attachments: ComposerAttachmentView[];
  addFiles: (files: File[]) => Promise<void>;
  remove: (id: string) => void;
  clear: () => void;
}

export function useComposerAttachments(): UseComposerAttachmentsResult {
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const uploadsDirReady = useRef(false);

  // Revoke blob URLs on unmount so images don't leak.
  useEffect(() => {
    return () => {
      for (const a of attachments) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      }
    };
    // Intentionally empty deps — cleanup only on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadOne = useCallback(async (file: File): Promise<void> => {
    if (!uploadsDirReady.current) {
      try {
        await createFolder("~", { name: "uploads", recursive: true });
      } catch {
        /* Already exists or will surface during upload. */
      }
      uploadsDirReady.current = true;
    }

    const id = genId();
    const uploadName = makeUploadName(file);
    const previewUrl = isImageName(file.name) ? URL.createObjectURL(file) : undefined;
    const controller = new AbortController();

    setAttachments((prev) => [
      ...prev,
      {
        id,
        name: file.name,
        size: file.size,
        previewUrl,
        progress: 0,
        controller,
        originalFile: file,
      },
    ]);

    try {
      await uploadFile(UPLOADS_DIR, file, {
        relativePath: uploadName,
        signal: controller.signal,
        onProgress: (frac) => {
          setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, progress: frac } : a)));
        },
      });
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, progress: 1, uploadedPath: `${UPLOADS_DIR}/${uploadName}` } : a,
        ),
      );
      // The workspace index cached in localStorage now misses this file.
      // Invalidate so the next `@`-search sees it.
      invalidateWorkspaceIndex();
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") {
        // The ×-click handler already removed the attachment.
        return;
      }
      setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, error: errMsg(err) } : a)));
    }
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      await Promise.all(files.map((f) => uploadOne(f)));
    },
    [uploadOne],
  );

  const remove = useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) {
        if (!target.uploadedPath && !target.error) {
          try {
            target.controller.abort();
          } catch {
            /* noop */
          }
        }
        if (target.previewUrl) URL.revokeObjectURL(target.previewUrl);
        if (target.uploadedPath) {
          deleteFile(target.uploadedPath).catch(() => {
            /* non-fatal */
          });
          // Removed file is gone from disk too — refresh the index.
          invalidateWorkspaceIndex();
        }
      }
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setAttachments((prev) => {
      // Revoke blobs; leave uploaded files on disk (they were referenced
      // in the message we just sent).
      for (const a of prev) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      }
      return [];
    });
  }, []);

  // Return the view shape so callers can't accidentally introspect the
  // controller / originalFile.
  const view: ComposerAttachmentView[] = attachments.map((a) => ({
    id: a.id,
    name: a.name,
    size: a.size,
    previewUrl: a.previewUrl,
    uploadedPath: a.uploadedPath,
    progress: a.progress,
    error: a.error,
  }));

  return { attachments: view, addFiles, remove, clear };
}
