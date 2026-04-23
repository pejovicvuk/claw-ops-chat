"use client";

import { AttachmentPill, type AttachmentPillData } from "./attachment-pill";

interface AttachmentRowProps {
  attachments: AttachmentPillData[];
  onRemove: (id: string) => void;
}

/**
 * Horizontal row of preview cards rendered above the chat textarea.
 * Scrolls when there are more cards than fit. Hidden entirely when empty
 * so the composer stays its usual height.
 */
export function AttachmentRow({ attachments, onRemove }: AttachmentRowProps) {
  if (attachments.length === 0) return null;
  return (
    <div
      className="scrollbar-thin flex w-full items-center gap-3 overflow-x-auto px-1 pb-2 pt-1"
      role="list"
      aria-label="Attachments"
    >
      {attachments.map((a) => (
        <div key={a.id} role="listitem">
          <AttachmentPill attachment={a} onRemove={onRemove} />
        </div>
      ))}
    </div>
  );
}
