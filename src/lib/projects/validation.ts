/**
 * Pure validation helpers for project names. Lives in its own module
 * (separate from paths.ts) so the client bundle can import these without
 * pulling in `fs`/`os` from the server-only path helpers.
 */

/**
 * Filesystem-safe project slug. Lowercase, alphanumeric + hyphens, must
 * start with an alphanumeric, 1-64 chars. Rejects path traversal (`..`),
 * separators (`/`, `\`), null bytes, and dotfile names by construction.
 */
export const PROJECT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Minimum 1, max 64 chars after trim. */
export const DISPLAY_NAME_MIN = 1;
export const DISPLAY_NAME_MAX = 64;

/**
 * Convert a free-form display name into a filesystem-safe slug:
 *   - lowercase
 *   - replace any run of non-alphanumeric with a single `-`
 *   - trim leading/trailing `-`
 *   - clamp to 64 chars
 *
 * Returns "" if nothing alphanumeric survives. Callers must check the
 * result against `PROJECT_SLUG_RE` before trusting it.
 */
export function slugifyDisplayName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 64);
}

export interface DisplayNameValidation {
  ok: boolean;
  /** Human-readable error message, present iff `ok === false`. */
  error?: string;
  /** Slug derived from the (trimmed) name, present iff `ok === true`. */
  slug?: string;
}

/**
 * Gate for free-form display names. Used by both the API and the client
 * modal so the validation rules don't drift between the two.
 */
export function validateDisplayName(raw: unknown): DisplayNameValidation {
  if (typeof raw !== "string") {
    return { ok: false, error: "displayName is required" };
  }
  const trimmed = raw.trim();
  if (trimmed.length < DISPLAY_NAME_MIN) {
    return { ok: false, error: "Project name cannot be empty" };
  }
  if (trimmed.length > DISPLAY_NAME_MAX) {
    return { ok: false, error: `Project name must be ${DISPLAY_NAME_MAX} characters or fewer` };
  }
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    return { ok: false, error: "Project name cannot contain control characters" };
  }
  if (/[/\\]/.test(trimmed)) {
    return { ok: false, error: "Project name cannot contain '/' or '\\'" };
  }
  const slug = slugifyDisplayName(trimmed);
  if (!PROJECT_SLUG_RE.test(slug)) {
    return {
      ok: false,
      error: "Project name must contain at least one letter or number",
    };
  }
  return { ok: true, slug };
}

/**
 * Validate a slug against `PROJECT_SLUG_RE` and throw if it doesn't match.
 *
 * Every fs operation in `store.ts` calls this BEFORE joining the slug to
 * `PROJECTS_ROOT`. Because the regex rejects `..`, `/`, `\`, and null
 * bytes, the resulting `join(PROJECTS_ROOT, slug)` cannot escape the
 * root — `safePath()` would be redundant for these routes.
 */
export function assertProjectSlug(slug: string): void {
  if (!PROJECT_SLUG_RE.test(slug)) {
    throw new Error(`Invalid project slug: ${slug}`);
  }
}

/* ──────────────────────────────────────────────────────────────────── */
/*  Repo URL validation (item imports)                                   */
/* ──────────────────────────────────────────────────────────────────── */

export type RepoKind = "github" | "bitbucket";

const REPO_HOSTS: Record<RepoKind, string> = {
  github: "github.com",
  bitbucket: "bitbucket.org",
};

export interface RepoUrlValidation {
  ok: boolean;
  error?: string;
  /** Owner / workspace segment, present iff `ok`. */
  owner?: string;
  /** Repo name (with any `.git` suffix stripped), present iff `ok`. */
  repo?: string;
  /** Canonical clone URL `https://<host>/<owner>/<repo>.git`, present iff `ok`. */
  normalizedUrl?: string;
}

/**
 * Strict shape check for a clone URL. Accepts only:
 *   - scheme `https`
 *   - exact hostname (`github.com` or `bitbucket.org`, case-insensitive)
 *   - path of exactly `/<owner>/<repo>` (trailing `.git` allowed, stripped)
 *
 * Rejects: ssh URLs, deeper paths (`/tree/main/...`), query strings,
 * fragments, ports, embedded credentials, IDN/punycode hostnames.
 *
 * The strict shape is what lets us safely interpolate the URL into a
 * `git clone` argv without an injection surface — there are no spaces,
 * shell metachars, or unexpected schemes that could break out.
 */
export function validateRepoUrl(kind: RepoKind, raw: unknown): RepoUrlValidation {
  if (typeof raw !== "string") return { ok: false, error: "Repo URL is required" };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, error: "Repo URL is required" };
  if (trimmed.length > 2048) return { ok: false, error: "Repo URL is too long" };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "Repo URL must be an https:// URL" };
  }

  if (url.protocol !== "https:") {
    return { ok: false, error: "Only https:// URLs are supported (no SSH)" };
  }
  const expectedHost = REPO_HOSTS[kind];
  if (url.hostname.toLowerCase() !== expectedHost) {
    return { ok: false, error: `URL must be on ${expectedHost}` };
  }
  if (url.port) return { ok: false, error: "Repo URL must not include a port" };
  if (url.username || url.password) {
    return { ok: false, error: "Repo URL must not include credentials" };
  }
  if (url.search || url.hash) {
    return { ok: false, error: "Repo URL must not include query string or fragment" };
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) {
    return { ok: false, error: "URL must point to a repo (e.g. https://host/owner/repo)" };
  }
  const owner = segments[0];
  let repo = segments[1];
  if (repo.endsWith(".git")) repo = repo.slice(0, -".git".length);
  if (owner.length === 0 || repo.length === 0) {
    return { ok: false, error: "Owner and repo segments cannot be empty" };
  }
  // Repo / owner names on github & bitbucket can include underscores and
  // dots; lock to a conservative charset to avoid weird argv shapes.
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) {
    return { ok: false, error: "Owner and repo may only contain letters, numbers, '.', '_', '-'" };
  }
  if (owner === "." || owner === ".." || repo === "." || repo === "..") {
    return { ok: false, error: "Owner and repo cannot be '.' or '..'" };
  }

  return {
    ok: true,
    owner,
    repo,
    normalizedUrl: `https://${expectedHost}/${owner}/${repo}.git`,
  };
}
