import type { ProjectMeta } from "./projects/store";

/**
 * Browser-side fetch helpers for the Projects API. Mirrors the shape of
 * `reports-api.ts`. Routes are scoped under `/chat/api/projects` per the
 * app's basePath.
 */

const BASE = "/chat/api/projects";

export type { ProjectMeta };

/**
 * Error thrown by the API helpers when a non-2xx response comes back.
 * Carries the parsed `error` field so the modal can show a 409 inline
 * without re-parsing the response.
 */
export class ProjectsApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ProjectsApiError";
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (typeof body.error === "string") return body.error;
  } catch {
    // fall through to generic message
  }
  return `${res.status} ${res.statusText}`;
}

export async function fetchProjects(): Promise<{ projects: ProjectMeta[] }> {
  const res = await fetch(BASE);
  if (!res.ok) throw new ProjectsApiError(res.status, await readError(res));
  return (await res.json()) as { projects: ProjectMeta[] };
}

export async function createProjectApi(displayName: string): Promise<ProjectMeta> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  if (!res.ok) throw new ProjectsApiError(res.status, await readError(res));
  const body = (await res.json()) as { project: ProjectMeta };
  return body.project;
}

export async function deleteProjectApi(slug: string): Promise<void> {
  const res = await fetch(`${BASE}/${encodeURIComponent(slug)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new ProjectsApiError(res.status, await readError(res));
  }
}
