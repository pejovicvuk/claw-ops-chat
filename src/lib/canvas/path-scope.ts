/**
 * Pure helper: is `path` inside the boundary `root`?
 *
 * Used by the file browser when an item canvas is open: navigation,
 * breadcrumb rendering, and keyboard shortcuts all gate on this rule
 * so the user can't escape the item folder. One source of truth so
 * the visible breadcrumb chips and the executable navigation never
 * drift out of sync.
 */

export function isInside(root: string | null | undefined, path: string): boolean {
  if (!root) return true; // no scope → free roaming
  if (typeof path !== "string" || path.length === 0) return false;
  // Strip trailing slash on the root so "/a/b/" and "/a/b" match identically.
  const r = root.endsWith("/") && root.length > 1 ? root.slice(0, -1) : root;
  if (path === r) return true;
  // Filesystem root is a special case — every absolute path is "inside" it.
  if (r === "/") return path.startsWith("/");
  // Path must be a strict descendant of `r`. Without the explicit "/" check
  // a root of "/a/b" would falsely accept "/a/bc".
  return path.startsWith(r + "/");
}
