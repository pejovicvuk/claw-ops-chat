import { existsSync } from "fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shared state between the test file and the hoisted mock factory — the
// factory runs in its own module-graph context and can't close over our
// regular top-level variables. Mirrors the pattern in run-store.test.ts.
const state = vi.hoisted(() => ({ root: "" }));

vi.mock("./paths", async () => {
  const { join: pJoin } = await import("path");
  const { existsSync: exists } = await import("fs");
  const { mkdir: mk } = await import("fs/promises");
  const PROJECT_META_FILENAME = ".project.json";
  return {
    PROJECT_META_FILENAME,
    PROJECT_META_VERSION: 1,
    get PROJECTS_ROOT() {
      return state.root;
    },
    projectDir: (slug: string) => pJoin(state.root, slug),
    projectMetaPath: (slug: string) => pJoin(state.root, slug, PROJECT_META_FILENAME),
    ensureProjectsTree: async () => {
      if (!exists(state.root)) await mk(state.root, { recursive: true });
    },
  };
});

const { createProject, deleteProject, listProjects, projectExists, readProjectMeta } =
  await import("./store");

describe("projects store", () => {
  beforeEach(async () => {
    state.root = await mkdtemp(join(tmpdir(), "projects-test-"));
  });

  afterEach(async () => {
    if (state.root && existsSync(state.root)) {
      await rm(state.root, { recursive: true, force: true });
    }
  });

  it("createProject writes the folder + metadata", async () => {
    const meta = await createProject("My Test Project");
    expect(meta.slug).toBe("my-test-project");
    expect(meta.displayName).toBe("My Test Project");
    expect(meta.itemCount).toBe(0);

    const sidecar = JSON.parse(
      await readFile(join(state.root, "my-test-project", ".project.json"), "utf-8"),
    );
    expect(sidecar.version).toBe(1);
    expect(sidecar.displayName).toBe("My Test Project");
    expect(typeof sidecar.createdAt).toBe("number");
  });

  it("createProject rejects duplicates with EEXISTS", async () => {
    await createProject("Same");
    await expect(createProject("Same")).rejects.toThrow("EEXISTS");
  });

  it("createProject trims the display name", async () => {
    const meta = await createProject("   spaced   ");
    expect(meta.slug).toBe("spaced");
    expect(meta.displayName).toBe("spaced");
  });

  it("listProjects returns created projects sorted newest first", async () => {
    const a = await createProject("Alpha");
    await new Promise((r) => setTimeout(r, 5));
    const b = await createProject("Bravo");
    const list = await listProjects();
    expect(list.map((p) => p.slug)).toEqual([b.slug, a.slug]);
  });

  it("listProjects ignores folders without .project.json", async () => {
    await createProject("Real");
    await mkdir(join(state.root, "fake-folder"));
    await mkdir(join(state.root, "another-fake"));
    const list = await listProjects();
    expect(list.map((p) => p.slug)).toEqual(["real"]);
  });

  it("listProjects ignores folders with malformed .project.json", async () => {
    await createProject("Real");
    const badDir = join(state.root, "broken");
    await mkdir(badDir);
    await writeFile(join(badDir, ".project.json"), "{ not json", "utf-8");
    const list = await listProjects();
    expect(list.map((p) => p.slug)).toEqual(["real"]);
  });

  it("listProjects ignores entries that don't match the slug regex", async () => {
    await createProject("Real");
    await mkdir(join(state.root, "Bad-Caps"));
    await mkdir(join(state.root, "with space"));
    const list = await listProjects();
    expect(list.map((p) => p.slug)).toEqual(["real"]);
  });

  it("listProjects counts items in the project folder, ignoring .project.json", async () => {
    await createProject("Counted");
    const dir = join(state.root, "counted");
    await writeFile(join(dir, "a.txt"), "a", "utf-8");
    await writeFile(join(dir, "b.txt"), "b", "utf-8");
    const list = await listProjects();
    expect(list[0].itemCount).toBe(2);
  });

  it("readProjectMeta returns the project, null when missing", async () => {
    await createProject("Existing");
    const meta = await readProjectMeta("existing");
    expect(meta?.displayName).toBe("Existing");
    const missing = await readProjectMeta("nope");
    expect(missing).toBeNull();
  });

  it("projectExists reflects the folder, not the metadata", async () => {
    await createProject("With Meta");
    expect(await projectExists("with-meta")).toBe(true);
    await mkdir(join(state.root, "no-meta"));
    expect(await projectExists("no-meta")).toBe(true);
    expect(await projectExists("ghost")).toBe(false);
  });

  it("deleteProject removes the folder", async () => {
    await createProject("Doomed");
    expect(await projectExists("doomed")).toBe(true);
    await deleteProject("doomed");
    expect(await projectExists("doomed")).toBe(false);
  });

  it("deleteProject is a no-op when the folder is missing", async () => {
    await expect(deleteProject("ghost")).resolves.toBeUndefined();
  });

  it("rejects traversal slugs before any fs call", async () => {
    await expect(projectExists("../escape")).rejects.toThrow(/Invalid project slug/);
    await expect(deleteProject("../escape")).rejects.toThrow(/Invalid project slug/);
    await expect(readProjectMeta("../escape")).rejects.toThrow(/Invalid project slug/);
  });
});
