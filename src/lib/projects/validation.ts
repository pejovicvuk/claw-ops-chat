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
