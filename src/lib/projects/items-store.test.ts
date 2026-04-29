import { existsSync } from "fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shared mock state pattern (same as store.test.ts) — the hoisted mock
// factory runs in its own module-graph context and can't close over
// top-level variables.
const state = vi.hoisted(() => ({ root: "" }));

vi.mock("./paths", async () => {
  const { join: pJoin } = await import("path");
  const ITEM_META_FILENAME = ".item.json";
  const PROJECT_META_FILENAME = ".project.json";
  return {
    ITEM_META_FILENAME,
    ITEM_META_VERSION: 1,
    PROJECT_META_FILENAME,
    PROJECT_META_VERSION: 1,
    get PROJECTS_ROOT() {
      return state.root;
    },
    projectDir: (slug: string) => pJoin(state.root, slug),
    projectMetaPath: (slug: string) => pJoin(state.root, slug, PROJECT_META_FILENAME),
    itemDir: (proj: string, item: string) => pJoin(state.root, proj, item),
    itemMetaPath: (proj: string, item: string) => pJoin(state.root, proj, item, ITEM_META_FILENAME),
    ensureProjectsTree: async () => {},
  };
});

// Mock the clone helper so tests stay hermetic — we only verify the
// repo-item path *calls* it correctly + writes the right metadata.
vi.mock("./clone", () => ({
  cloneRepo: vi.fn().mockResolvedValue(undefined),
  CloneAuthMissingError: class CloneAuthMissingError extends Error {
    kind: string;
    constructor(kind: string) {
      super(`${kind} is not connected`);
      this.kind = kind;
    }
  },
  buildCloneEnv: vi.fn(),
  scrubCloneStderr: vi.fn((s: string) => s),
}));

const { cloneRepo } = await import("./clone");
const { createFolderItem, createRepoItem, deleteItem, itemExists, listItems, readItemMeta } =
  await import("./items-store");

const PROJECT = "demo-project";

describe("items store", () => {
  beforeEach(async () => {
    state.root = await mkdtemp(join(tmpdir(), "items-test-"));
    await mkdir(join(state.root, PROJECT));
    await writeFile(
      join(state.root, PROJECT, ".project.json"),
      JSON.stringify({ version: 1, displayName: "Demo", createdAt: Date.now() }),
    );
    vi.mocked(cloneRepo).mockReset();
    vi.mocked(cloneRepo).mockImplementation(async ({ targetDir }) => {
      // simulate a successful clone by dropping a couple of files
      await writeFile(join(targetDir, "README.md"), "# clone");
      await mkdir(join(targetDir, ".git"));
    });
  });

  afterEach(async () => {
    if (state.root && existsSync(state.root)) {
      await rm(state.root, { recursive: true, force: true });
    }
  });

  it("createFolderItem writes the folder + metadata", async () => {
    const item = await createFolderItem(PROJECT, "Notes");
    expect(item.slug).toBe("notes");
    expect(item.kind).toBe("folder");
    expect(item.repoUrl).toBeNull();
    expect(item.itemCount).toBe(0);

    const sidecar = JSON.parse(
      await readFile(join(state.root, PROJECT, "notes", ".item.json"), "utf-8"),
    );
    expect(sidecar.version).toBe(1);
    expect(sidecar.displayName).toBe("Notes");
    expect(sidecar.kind).toBe("folder");
    expect(sidecar.repoUrl).toBeNull();
  });

  it("createFolderItem rejects duplicates", async () => {
    await createFolderItem(PROJECT, "Same");
    await expect(createFolderItem(PROJECT, "Same")).rejects.toThrow("EEXISTS");
  });

  it("createRepoItem clones, writes metadata, and surfaces the URL", async () => {
    const item = await createRepoItem(
      PROJECT,
      "github",
      "claude-code",
      "https://github.com/anthropics/claude-code.git",
    );
    expect(item.slug).toBe("claude-code");
    expect(item.kind).toBe("github");
    expect(item.repoUrl).toBe("https://github.com/anthropics/claude-code.git");
    expect(item.itemCount).toBeGreaterThan(0);

    expect(cloneRepo).toHaveBeenCalledOnce();
    const call = vi.mocked(cloneRepo).mock.calls[0][0];
    expect(call.kind).toBe("github");
    expect(call.repoUrl).toBe("https://github.com/anthropics/claude-code.git");
    expect(call.targetDir).toBe(join(state.root, PROJECT, "claude-code"));

    const sidecar = JSON.parse(
      await readFile(join(state.root, PROJECT, "claude-code", ".item.json"), "utf-8"),
    );
    expect(sidecar.kind).toBe("github");
    expect(sidecar.repoUrl).toBe("https://github.com/anthropics/claude-code.git");
  });

  it("createRepoItem cleans up the directory on clone failure", async () => {
    vi.mocked(cloneRepo).mockRejectedValueOnce(new Error("network sad"));
    await expect(
      createRepoItem(PROJECT, "github", "broken", "https://github.com/x/broken.git"),
    ).rejects.toThrow("network sad");
    expect(existsSync(join(state.root, PROJECT, "broken"))).toBe(false);
  });

  it("listItems ignores subdirs without .item.json", async () => {
    await createFolderItem(PROJECT, "Real");
    await mkdir(join(state.root, PROJECT, "fake"));
    await mkdir(join(state.root, PROJECT, "another-fake"));
    const items = await listItems(PROJECT);
    expect(items.map((i) => i.slug)).toEqual(["real"]);
  });

  it("listItems ignores entries that don't match the slug regex", async () => {
    await createFolderItem(PROJECT, "Real");
    await mkdir(join(state.root, PROJECT, "Bad-Caps"));
    await mkdir(join(state.root, PROJECT, "with space"));
    const items = await listItems(PROJECT);
    expect(items.map((i) => i.slug)).toEqual(["real"]);
  });

  it("listItems sorts newest first", async () => {
    const a = await createFolderItem(PROJECT, "Alpha");
    await new Promise((r) => setTimeout(r, 5));
    const b = await createFolderItem(PROJECT, "Bravo");
    const items = await listItems(PROJECT);
    expect(items.map((i) => i.slug)).toEqual([b.slug, a.slug]);
  });

  it("listItems counts shallow children, ignoring .item.json", async () => {
    await createFolderItem(PROJECT, "Counted");
    await writeFile(join(state.root, PROJECT, "counted", "a.txt"), "a");
    await writeFile(join(state.root, PROJECT, "counted", "b.txt"), "b");
    const items = await listItems(PROJECT);
    expect(items[0].itemCount).toBe(2);
  });

  it("readItemMeta returns the item, null when missing", async () => {
    await createFolderItem(PROJECT, "Existing");
    const item = await readItemMeta(PROJECT, "existing");
    expect(item?.displayName).toBe("Existing");
    expect(await readItemMeta(PROJECT, "ghost")).toBeNull();
  });

  it("itemExists reflects the folder, not the metadata", async () => {
    await createFolderItem(PROJECT, "With Meta");
    expect(await itemExists(PROJECT, "with-meta")).toBe(true);
    await mkdir(join(state.root, PROJECT, "no-meta"));
    expect(await itemExists(PROJECT, "no-meta")).toBe(true);
    expect(await itemExists(PROJECT, "ghost")).toBe(false);
  });

  it("deleteItem removes the folder and is a no-op when missing", async () => {
    await createFolderItem(PROJECT, "Doomed");
    expect(await itemExists(PROJECT, "doomed")).toBe(true);
    await deleteItem(PROJECT, "doomed");
    expect(await itemExists(PROJECT, "doomed")).toBe(false);
    await expect(deleteItem(PROJECT, "ghost")).resolves.toBeUndefined();
  });

  it("rejects traversal slugs before any fs call", async () => {
    await expect(itemExists(PROJECT, "../escape")).rejects.toThrow(/Invalid project slug/);
    await expect(deleteItem(PROJECT, "../escape")).rejects.toThrow(/Invalid project slug/);
    await expect(readItemMeta(PROJECT, "../escape")).rejects.toThrow(/Invalid project slug/);
    await expect(itemExists("../escape", "x")).rejects.toThrow(/Invalid project slug/);
  });

  it("listItems returns [] for a missing project", async () => {
    const items = await listItems("never-existed");
    expect(items).toEqual([]);
  });
});
