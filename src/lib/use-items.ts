"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchItems, type ItemMeta } from "./items-api";

/**
 * Fetch + refresh the items list for one project. No polling — folders
 * don't have status that changes server-side, so we refresh on mount and
 * whenever the caller invokes `refresh()` (after create/delete).
 */
export function useItems(projectSlug: string | null) {
  const [items, setItems] = useState<ItemMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectSlug) {
      setItems([]);
      setLoading(false);
      return;
    }
    try {
      const { items: next } = await fetchItems(projectSlug);
      setItems(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load items");
    } finally {
      setLoading(false);
    }
  }, [projectSlug]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { items, loading, error, refresh };
}
