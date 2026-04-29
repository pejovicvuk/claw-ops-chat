/**
 * Server-side normalizers that translate GitHub / Bitbucket REST API
 * payloads into the cross-host `RepoSummary` shape consumed by the
 * Add Item picker. Kept pure so the route handlers stay thin and tests
 * don't need an HTTP layer.
 */

import type { RepoSummary } from "../repos-api";

interface GithubRepoApi {
  name?: unknown;
  full_name?: unknown;
  owner?: { login?: unknown };
  description?: unknown;
  private?: unknown;
  html_url?: unknown;
  clone_url?: unknown;
  pushed_at?: unknown;
  updated_at?: unknown;
}

export function normalizeGithubRepo(raw: GithubRepoApi): RepoSummary | null {
  const name = typeof raw.name === "string" ? raw.name : null;
  const fullName = typeof raw.full_name === "string" ? raw.full_name : null;
  const owner = typeof raw.owner?.login === "string" ? raw.owner.login : null;
  const htmlUrl = typeof raw.html_url === "string" ? raw.html_url : null;
  const cloneUrl = typeof raw.clone_url === "string" ? raw.clone_url : null;
  if (!name || !fullName || !owner || !htmlUrl || !cloneUrl) return null;
  const pushedSource =
    typeof raw.pushed_at === "string"
      ? raw.pushed_at
      : typeof raw.updated_at === "string"
        ? raw.updated_at
        : null;
  const pushedMs = pushedSource ? Date.parse(pushedSource) : NaN;
  return {
    host: "github.com",
    owner,
    name,
    fullName,
    description: typeof raw.description === "string" ? raw.description : null,
    private: raw.private === true,
    htmlUrl,
    cloneUrl,
    pushedAt: Number.isFinite(pushedMs) ? pushedMs : 0,
  };
}

interface BitbucketLink {
  href?: unknown;
  name?: unknown;
}

interface BitbucketRepoApi {
  slug?: unknown;
  name?: unknown;
  full_name?: unknown;
  description?: unknown;
  is_private?: unknown;
  updated_on?: unknown;
  links?: {
    html?: BitbucketLink;
    clone?: unknown;
  };
}

export function normalizeBitbucketRepo(raw: BitbucketRepoApi): RepoSummary | null {
  // Prefer slug for filesystem-safe naming; fall back to name if slug absent.
  const slug = typeof raw.slug === "string" ? raw.slug : null;
  const name = typeof raw.name === "string" ? raw.name : slug;
  const fullName = typeof raw.full_name === "string" ? raw.full_name : null;
  if (!slug || !name || !fullName) return null;
  const ownerSegment = fullName.split("/")[0];
  if (!ownerSegment) return null;
  const htmlUrl = typeof raw.links?.html?.href === "string" ? raw.links.html.href : null;
  const cloneUrl = pickBitbucketHttpsClone(raw.links?.clone);
  if (!htmlUrl || !cloneUrl) return null;
  const updated = typeof raw.updated_on === "string" ? Date.parse(raw.updated_on) : NaN;
  return {
    host: "bitbucket.org",
    owner: ownerSegment,
    name: slug,
    fullName,
    description:
      typeof raw.description === "string" && raw.description.length > 0 ? raw.description : null,
    private: raw.is_private === true,
    htmlUrl,
    cloneUrl,
    pushedAt: Number.isFinite(updated) ? updated : 0,
  };
}

/**
 * Bitbucket `links.clone` is an array of `{ name, href }` pairs (one per
 * protocol). We want the https one, sans embedded user credentials, with a
 * `.git` suffix so it lines up with `validateRepoUrl`'s normalized shape.
 */
function pickBitbucketHttpsClone(links: unknown): string | null {
  if (!Array.isArray(links)) return null;
  for (const link of links) {
    if (!link || typeof link !== "object") continue;
    const obj = link as BitbucketLink;
    if (obj.name !== "https") continue;
    if (typeof obj.href !== "string") continue;
    return stripCredentials(obj.href);
  }
  return null;
}

function stripCredentials(url: string): string {
  try {
    const u = new URL(url);
    u.username = "";
    u.password = "";
    let cloneUrl = u.toString();
    if (!cloneUrl.endsWith(".git")) cloneUrl += ".git";
    return cloneUrl;
  } catch {
    return url;
  }
}

/**
 * Parse the GitHub `Link` header to detect whether more pages exist.
 * Format: `<https://api.github.com/.../page=2>; rel="next", <...>; rel="last"`.
 * We don't need the URL — only the presence of `rel="next"`.
 */
export function githubHasNextPage(linkHeader: string | null): boolean {
  if (!linkHeader) return false;
  return /rel="next"/.test(linkHeader);
}
