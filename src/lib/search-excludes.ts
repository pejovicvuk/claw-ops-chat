/**
 * Directory names that are never walked when building the workspace
 * index. Fast name-based match — no glob / .gitignore parsing. These are
 * universally uninteresting for `@`-search: vendored code, VCS internals,
 * build outputs, IDE scratch, and Python / Node caches.
 *
 * Keep the list short and obvious. The cost of a too-aggressive exclude
 * is "you can't @-reference a file in node_modules" which is fine; the
 * cost of a missing exclude is a 5-second index build on a fresh `npm
 * install` repo. Adjust conservatively.
 */
export const SEARCH_EXCLUDED_DIR_NAMES: ReadonlySet<string> = new Set([
  // VCS
  ".git",
  ".hg",
  ".svn",
  // Package caches / dependency installs
  "node_modules",
  ".pnpm",
  ".yarn",
  ".venv",
  "venv",
  "__pycache__",
  // Build outputs
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".turbo",
  ".svelte-kit",
  ".vercel",
  ".output",
  "target",
  // Test / coverage artifacts
  "coverage",
  ".nyc_output",
  // IDE / tooling
  ".vscode",
  ".idea",
  ".cache",
  ".parcel-cache",
  ".rollup.cache",
  ".eslintcache",
  // OS junk
  ".DS_Store",
]);
