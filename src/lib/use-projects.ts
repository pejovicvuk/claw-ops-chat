"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchProjects, type ProjectMeta } from "./projects-api";

/**
 * Fetch + refresh the project list. No polling — folders don't have
 * status that changes server-side, so we refresh on mount and whenever
 * the caller invokes `refresh()` (after create/delete, or via the
 * sidebar refresh button).
 */
export function useProjects() {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { projects: next } = await fetchProjects();
      setProjects(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { projects, loading, error, refresh };
}
