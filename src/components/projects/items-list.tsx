"use client";

import type { ItemMeta } from "@/lib/items-api";
import { ItemCard } from "./item-card";

interface ItemsListProps {
  items: ItemMeta[];
  loading: boolean;
  onOpen: (slug: string) => void;
  onDelete: (item: ItemMeta) => void;
}

/**
 * Flat list of items inside a project. Skeleton on initial load; renders
 * nothing when empty (the parent owns the empty-state copy so it can put
 * the Add Item button next to it).
 */
export function ItemsList({ items, loading, onOpen, onDelete }: ItemsListProps) {
  if (loading && items.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-[60px] rounded-xl bg-canvas-surface-hover/50 animate-pulse"
            style={{ animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <ItemCard
          key={item.slug}
          item={item}
          onOpen={() => onOpen(item.slug)}
          onDelete={() => onDelete(item)}
        />
      ))}
    </div>
  );
}
