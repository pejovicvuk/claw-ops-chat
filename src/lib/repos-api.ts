import { ProjectsApiError } from "./projects-api";
import type { RepoKind } from "./projects/validation";

/**
 * Browser-side fetch helpers for the repo-listing endpoints.
 *
 * These fetch the user's GitHub / Bitbucket repos via the credentials
 * stored on the server — the client never sees the token.
 */

export interface RepoSummary {
  host: "github.com" | "bitbucket.org";
  owner: string;
  name: string;
  /** `<owner>/<name>`, suitable for searching by either segment. */
  fullName: string;
  description: string | null;
  private: boolean;
  /** `https://<host>/<owner>/<name>` — for "View on GitHub" links. */
  htmlUrl: string;
  /** `https://<host>/<owner>/<name>.git` — what gets passed to `cloneRepo`. */
  cloneUrl: string;
  /** ms epoch; 0 if the host didn't report a timestamp. */
  pushedAt: number;
}

export interface RepoListResponse {
  repos: RepoSummary[];
  /** True iff the host indicated more pages exist beyond what we returned. */
  truncated: boolean;
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

export async function fetchGithubRepos(): Promise<RepoListResponse> {
  const res = await fetch("/chat/api/github-custom/repos");
  if (!res.ok) throw new ProjectsApiError(res.status, await readError(res));
  return (await res.json()) as RepoListResponse;
}

export async function fetchBitbucketRepos(): Promise<RepoListResponse> {
  const res = await fetch("/chat/api/atlassian-custom/repos");
  if (!res.ok) throw new ProjectsApiError(res.status, await readError(res));
  return (await res.json()) as RepoListResponse;
}

export async function fetchReposForKind(kind: RepoKind): Promise<RepoListResponse> {
  return kind === "github" ? fetchGithubRepos() : fetchBitbucketRepos();
}
