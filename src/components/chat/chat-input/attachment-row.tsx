"use client";

import { AttachmentPill, type AttachmentPillData } from "./attachment-pill";

interface AttachmentRowProps {
  attachments: AttachmentPillData[];
  onRemove: (id: string) => void;
  onRetry?: (id: string) => void;
}

/**
 * Horizontal row of attachment pills rendered above the chat textarea.
 * Scrolls if there are more pills than fit. Hidden entirely when empty so
 * the composer stays its usual height.
 */
export function AttachmentRow({ attachments, onRemove, onRetry }: AttachmentRowProps) {
  if (attachments.length === 0) return null;
  return (
    <div
      className="scrollbar-thin flex w-full items-center gap-2 overflow-x-auto px-1 pb-1.5 pt-0.5"
      role="list"
      aria-label="Attachments"
    >
      {attachments.map((a) => (
        <div key={a.id} role="listitem">
          <AttachmentPill attachment={a} onRemove={onRemove} onRetry={onRetry} />
        </div>
      ))}
    </div>
  );
}
