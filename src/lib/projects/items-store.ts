import { mkdir, readFile, readdir, rm, stat, writeFile } from "fs/promises";
import { ITEM_META_FILENAME, ITEM_META_VERSION, itemDir, itemMetaPath, projectDir } from "./paths";
import {
  PROJECT_SLUG_RE,
  type RepoKind,
  assertProjectSlug,
  slugifyDisplayName,
} from "./validation";
import { cloneRepo } from "./clone";

/**
 * CRUD for items inside a project. An "item" is a folder under
 * `~/projects/<project>/<item>/` carrying a `.item.json` sidecar that
 * records the display name and origin (folder vs. github vs. bitbucket).
 *
 * Subdirectories WITHOUT `.item.json` (e.g. `.git`, `node_modules` inside
 * a clone) are invisible to the items list — same pattern as the project
 * level skips folders without `.project.json`.
 */

export type ItemKind = "folder" | RepoKind;

export interface ItemMeta {
  slug: string;
  displayName: string;
  kind: ItemKind;
  /** null for `kind === "folder"`, the canonical clone URL otherwise. */
  repoUrl: string | null;
  createdAt: number;
  /** Shallow readdir count, ignoring the metadata sidecar. */
  itemCount: number;
  /**
   * Server-resolved absolute path on disk. The chat-window canvas reads
   * this and passes it as `sessionCwd` so a per-item Claude session
   * starts inside the item's folder instead of the server's home.
   */
  absolutePath: string;
}

interface ItemMetaFile {
  version: number;
  displayName: string;
  kind: ItemKind;
  repoUrl: string | null;
  createdAt: number;
}

function isItemKind(value: unknown): value is ItemKind {
  return value === "folder" || value === "github" || value === "bitbucket";
}

async function readItemMetaFile(
  projectSlug: string,
  itemSlug: string,
): Promise<ItemMetaFile | null> {
  try {
    const raw = await readFile(itemMetaPath(projectSlug, itemSlug), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as ItemMetaFile).displayName !== "string" ||
      typeof (parsed as ItemMetaFile).createdAt !== "number" ||
      !isItemKind((parsed as ItemMetaFile).kind)
    ) {
      return null;
    }
    const repoUrl = (parsed as ItemMetaFile).repoUrl;
    if (repoUrl !== null && typeof repoUrl !== "string") return null;
    return parsed as ItemMetaFile;
  } catch {
    return null;
  }
}

async function countChildEntries(projectSlug: string, itemSlug: string): Promise<number> {
  try {
    const entries = await readdir(itemDir(projectSlug, itemSlug));
    return entries.filter((e) => e !== ITEM_META_FILENAME).length;
  } catch {
    return 0;
  }
}

/** True iff the item folder exists on disk (sidecar not required). */
export async function itemExists(projectSlug: string, itemSlug: string): Promise<boolean> {
  assertProjectSlug(projectSlug);
  assertProjectSlug(itemSlug);
  try {
    return (await stat(itemDir(projectSlug, itemSlug))).isDirectory();
  } catch {
    return false;
  }
}

/**
 * List every item folder under a project, newest first. Skips entries
 * that aren't directories, fail the slug regex, or lack a valid
 * `.item.json` sidecar. Throws if the project itself doesn't exist.
 */
export async function listItems(projectSlug: string): Promise<ItemMeta[]> {
  assertProjectSlug(projectSlug);
  let entries: string[];
  try {
    entries = await readdir(projectDir(projectSlug));
  } catch {
    return [];
  }
  const out: ItemMeta[] = [];
  for (const slug of entries) {
    if (!PROJECT_SLUG_RE.test(slug)) continue;
    const dir = itemDir(projectSlug, slug);
    let isDir = false;
    try {
      isDir = (await stat(dir)).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const meta = await readItemMetaFile(projectSlug, slug);
    if (!meta) continue;
    out.push({
      slug,
      displayName: meta.displayName,
      kind: meta.kind,
      repoUrl: meta.repoUrl,
      createdAt: meta.createdAt,
      itemCount: await countChildEntries(projectSlug, slug),
      absolutePath: itemDir(projectSlug, slug),
    });
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

/** Read one item's metadata, or null if it's missing or malformed. */
export async function readItemMeta(
  projectSlug: string,
  itemSlug: string,
): Promise<ItemMeta | null> {
  assertProjectSlug(projectSlug);
  assertProjectSlug(itemSlug);
  if (!(await itemExists(projectSlug, itemSlug))) return null;
  const meta = await readItemMetaFile(projectSlug, itemSlug);
  if (!meta) return null;
  return {
    slug: itemSlug,
    displayName: meta.displayName,
    kind: meta.kind,
    repoUrl: meta.repoUrl,
    createdAt: meta.createdAt,
    itemCount: await countChildEntries(projectSlug, itemSlug),
    absolutePath: itemDir(projectSlug, itemSlug),
  };
}

async function writeMeta(projectSlug: string, itemSlug: string, meta: ItemMetaFile): Promise<void> {
  await writeFile(
    itemMetaPath(projectSlug, itemSlug),
    JSON.stringify(meta, null, 2) + "\n",
    "utf-8",
  );
}

/**
 * Create an empty folder item. `displayName` is re-validated defensively
 * via `slugifyDisplayName` + the slug regex; the API route is expected to
 * have already gated invalid input.
 *
 * Throws Error("EEXISTS") if the slug already collides on disk.
 */
export async function createFolderItem(
  projectSlug: string,
  displayName: string,
): Promise<ItemMeta> {
  assertProjectSlug(projectSlug);
  const trimmed = displayName.trim();
  const slug = slugifyDisplayName(trimmed);
  assertProjectSlug(slug);
  if (await itemExists(projectSlug, slug)) {
    throw new Error("EEXISTS");
  }
  await mkdir(itemDir(projectSlug, slug));
  const createdAt = Date.now();
  await writeMeta(projectSlug, slug, {
    version: ITEM_META_VERSION,
    displayName: trimmed,
    kind: "folder",
    repoUrl: null,
    createdAt,
  });
  return {
    slug,
    displayName: trimmed,
    kind: "folder",
    repoUrl: null,
    createdAt,
    itemCount: 0,
    absolutePath: itemDir(projectSlug, slug),
  };
}

/**
 * Clone a github / bitbucket repo into a new item folder. The display
 * name and slug both come from the URL's repo segment (slugified).
 *
 * On clone failure the partial directory is `rm -rf`'d so the user can
 * retry without needing to clean up by hand.
 *
 * Throws:
 *   - Error("EEXISTS") if the slug already collides
 *   - Error("ENOAUTH") if the matching integration isn't connected
 *   - GitExecError on clone failure (after the cleanup)
 */
export async function createRepoItem(
  projectSlug: string,
  kind: RepoKind,
  repoSegment: string,
  normalizedUrl: string,
): Promise<ItemMeta> {
  assertProjectSlug(projectSlug);
  const slug = slugifyDisplayName(repoSegment);
  assertProjectSlug(slug);
  if (await itemExists(projectSlug, slug)) {
    throw new Error("EEXISTS");
  }
  const dir = itemDir(projectSlug, slug);
  await mkdir(dir);
  try {
    await cloneRepo({ targetDir: dir, kind, repoUrl: normalizedUrl });
  } catch (err) {
    // Cleanup so the user can retry without leaving a half-cloned husk.
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
  const createdAt = Date.now();
  await writeMeta(projectSlug, slug, {
    version: ITEM_META_VERSION,
    displayName: repoSegment,
    kind,
    repoUrl: normalizedUrl,
    createdAt,
  });
  return {
    slug,
    displayName: repoSegment,
    kind,
    repoUrl: normalizedUrl,
    createdAt,
    itemCount: await countChildEntries(projectSlug, slug),
    absolutePath: itemDir(projectSlug, slug),
  };
}

/** Recursively remove an item folder. No-op if the folder is missing. */
export async function deleteItem(projectSlug: string, itemSlug: string): Promise<void> {
  assertProjectSlug(projectSlug);
  assertProjectSlug(itemSlug);
  await rm(itemDir(projectSlug, itemSlug), { recursive: true, force: true });
}
