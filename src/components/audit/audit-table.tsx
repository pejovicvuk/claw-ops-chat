"use client";

import { useEffect, useRef, useState } from "react";
import { FiLoader } from "react-icons/fi";
import type { AuditEvent } from "@/lib/audit/types";
import { AuditRow } from "./audit-row";

interface AuditTableProps {
  events: AuditEvent[];
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  onSelect: (event: AuditEvent) => void;
}

function eventKey(e: AuditEvent): string {
  return e.id ?? `${e.at}-${e.subject}`;
}

export function AuditTable({ events, hasMore, loading, onLoadMore, onSelect }: AuditTableProps) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Cascade in the first 8 rows of the FIRST non-empty render only. Events
  // that stream in via the IntersectionObserver pagination or live polling
  // don't restagger.
  const [initialIds, setInitialIds] = useState<Set<string> | null>(null);
  if (initialIds === null && events.length > 0) {
    setInitialIds(new Set(events.map(eventKey)));
  }

  // IntersectionObserver sentinel — load more as the user scrolls to the
  // bottom. At single-user volumes we don't need full virtualization;
  // event rows are light enough to render a few hundred in the DOM.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) onLoadMore();
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, onLoadMore]);

  if (events.length === 0 && !loading) {
    return (
      <div className="rounded-lg border border-dashed border-canvas-border px-6 py-10 text-center text-[12px] text-canvas-muted">
        No audit events for this filter.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-canvas-border bg-canvas-bg">
      <div className="max-h-[420px] overflow-y-auto">
        {events.map((event, eventIndex) => {
          const key = eventKey(event);
          const isInitial = initialIds?.has(key) === true;
          const staggerIdx = isInitial && eventIndex < 8 ? eventIndex : -1;
          return <AuditRow key={key} event={event} onSelect={onSelect} staggerIndex={staggerIdx} />;
        })}
        {hasMore && (
          <div ref={sentinelRef} className="flex items-center justify-center py-3">
            <FiLoader size={12} className="animate-spin text-canvas-muted" />
          </div>
        )}
        {!hasMore && events.length > 0 && (
          <div className="py-2 text-center text-[10.5px] text-canvas-muted">— end of log —</div>
        )}
      </div>
    </div>
  );
}
