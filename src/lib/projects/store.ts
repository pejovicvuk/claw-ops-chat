import { readFile, readdir, mkdir, rm, stat, writeFile } from "fs/promises";
import {
  PROJECT_META_FILENAME,
  PROJECT_META_VERSION,
  PROJECTS_ROOT,
  ensureProjectsTree,
  projectDir,
  projectMetaPath,
} from "./paths";
import { PROJECT_SLUG_RE, assertProjectSlug, slugifyDisplayName } from "./validation";

/**
 * CRUD for projects. A "project" is a folder under `PROJECTS_ROOT`
 * containing a `.project.json` sidecar with the user-typed display name.
 *
 * Folders WITHOUT a `.project.json` are invisible to the UI. This is what
 * lets the source tree at `/root/projects/claw-ops-chat/` coexist with
 * user projects at `/root/projects/<slug>/` without showing up in the
 * dashboard.
 */

export interface ProjectMeta {
  slug: string;
  displayName: string;
  createdAt: number;
  itemCount: number;
}

interface ProjectMetaFile {
  version: number;
  displayName: string;
  createdAt: number;
}

async function readMetaFile(slug: string): Promise<ProjectMetaFile | null> {
  try {
    const raw = await readFile(projectMetaPath(slug), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as ProjectMetaFile).displayName !== "string" ||
      typeof (parsed as ProjectMetaFile).createdAt !== "number"
    ) {
      return null;
    }
    return parsed as ProjectMetaFile;
  } catch {
    return null;
  }
}

async function countItems(slug: string): Promise<number> {
  try {
    const entries = await readdir(projectDir(slug));
    return entries.filter((e) => e !== PROJECT_META_FILENAME).length;
  } catch {
    return 0;
  }
}

/**
 * List every project folder, newest first. Skips entries that aren't
 * directories, fail the slug regex, or lack a valid `.project.json`.
 */
export async function listProjects(): Promise<ProjectMeta[]> {
  await ensureProjectsTree();
  let entries: string[];
  try {
    entries = await readdir(PROJECTS_ROOT);
  } catch {
    return [];
  }
  const out: ProjectMeta[] = [];
  for (const slug of entries) {
    if (!PROJECT_SLUG_RE.test(slug)) continue;
    const dir = projectDir(slug);
    let isDir = false;
    try {
      isDir = (await stat(dir)).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const meta = await readMetaFile(slug);
    if (!meta) continue;
    out.push({
      slug,
      displayName: meta.displayName,
      createdAt: meta.createdAt,
      itemCount: await countItems(slug),
    });
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

/** Returns true iff `<root>/<slug>` is a directory (regardless of `.project.json`). */
export async function projectExists(slug: string): Promise<boolean> {
  assertProjectSlug(slug);
  try {
    return (await stat(projectDir(slug))).isDirectory();
  } catch {
    return false;
  }
}

/** Read one project's metadata, or null if it's missing or malformed. */
export async function readProjectMeta(slug: string): Promise<ProjectMeta | null> {
  assertProjectSlug(slug);
  if (!(await projectExists(slug))) return null;
  const meta = await readMetaFile(slug);
  if (!meta) return null;
  return {
    slug,
    displayName: meta.displayName,
    createdAt: meta.createdAt,
    itemCount: await countItems(slug),
  };
}

/**
 * Create a new project from a free-form display name. The caller is
 * expected to have validated the name first; this function re-validates
 * defensively because it's the last gate before fs writes.
 *
 * Throws Error("EEXISTS") if the slug already collides on disk.
 */
export async function createProject(displayName: string): Promise<ProjectMeta> {
  await ensureProjectsTree();
  const trimmed = displayName.trim();
  const slug = slugifyDisplayName(trimmed);
  assertProjectSlug(slug);
  const dir = projectDir(slug);
  if (await projectExists(slug)) {
    throw new Error("EEXISTS");
  }
  // mkdir without `recursive` so a race that creates the folder between
  // our `projectExists` check and this call fails loudly with EEXIST.
  await mkdir(dir);
  const createdAt = Date.now();
  const meta: ProjectMetaFile = {
    version: PROJECT_META_VERSION,
    displayName: trimmed,
    createdAt,
  };
  await writeFile(projectMetaPath(slug), JSON.stringify(meta, null, 2) + "\n", "utf-8");
  return { slug, displayName: trimmed, createdAt, itemCount: 0 };
}

/** Recursively remove a project folder. No-op if the folder is missing. */
export async function deleteProject(slug: string): Promise<void> {
  assertProjectSlug(slug);
  await rm(projectDir(slug), { recursive: true, force: true });
}
