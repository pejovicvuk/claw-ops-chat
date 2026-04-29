import type { ItemMeta } from "./projects/items-store";
import { ProjectsApiError } from "./projects-api";
import type { RepoKind } from "./projects/validation";

/**
 * Browser-side fetch helpers for the project-items API. Mirrors the shape
 * of `projects-api.ts`. Routes are scoped under `/chat/api/projects` per
 * the app's basePath.
 */

export type { ItemMeta };

function base(projectSlug: string): string {
  return `/chat/api/projects/${encodeURIComponent(projectSlug)}/items`;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (typeof body.error === "string") return body.error;
  } catch {
    /* fall through */
  }
  return `${res.status} ${res.statusText}`;
}

export async function fetchItems(projectSlug: string): Promise<{ items: ItemMeta[] }> {
  const res = await fetch(base(projectSlug));
  if (!res.ok) throw new ProjectsApiError(res.status, await readError(res));
  return (await res.json()) as { items: ItemMeta[] };
}

export async function createFolderItemApi(
  projectSlug: string,
  displayName: string,
): Promise<ItemMeta> {
  const res = await fetch(base(projectSlug), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "folder", displayName }),
  });
  if (!res.ok) throw new ProjectsApiError(res.status, await readError(res));
  const body = (await res.json()) as { item: ItemMeta };
  return body.item;
}

export async function importRepoItemApi(
  projectSlug: string,
  kind: RepoKind,
  repoUrl: string,
): Promise<ItemMeta> {
  const res = await fetch(base(projectSlug), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, repoUrl }),
  });
  if (!res.ok) throw new ProjectsApiError(res.status, await readError(res));
  const body = (await res.json()) as { item: ItemMeta };
  return body.item;
}

export async function deleteItemApi(projectSlug: string, itemSlug: string): Promise<void> {
  const res = await fetch(`${base(projectSlug)}/${encodeURIComponent(itemSlug)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    throw new ProjectsApiError(res.status, await readError(res));
  }
}
