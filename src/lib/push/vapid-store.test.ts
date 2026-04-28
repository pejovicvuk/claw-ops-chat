import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVapidStore } from "./vapid-store";

describe("VapidStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "vapid-store-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null when the file does not exist", async () => {
    const store = createVapidStore({ path: join(dir, "vapid.json") });
    expect(await store.load()).toBeNull();
  });

  it("round-trips a saved keypair", async () => {
    const path = join(dir, "vapid.json");
    const a = createVapidStore({ path });
    const saved = await a.save({ publicKey: "PUB", privateKey: "PRIV" });
    expect(saved.publicKey).toBe("PUB");
    expect(saved.privateKey).toBe("PRIV");
    expect(saved.createdAt).toBeGreaterThan(0);

    const b = createVapidStore({ path });
    const loaded = await b.load();
    expect(loaded).not.toBeNull();
    expect(loaded?.publicKey).toBe("PUB");
    expect(loaded?.privateKey).toBe("PRIV");
    expect(loaded?.createdAt).toBe(saved.createdAt);
  });

  it("returns null for malformed JSON", async () => {
    const path = join(dir, "vapid.json");
    await writeFile(path, "not-json", "utf-8");
    const store = createVapidStore({ path });
    expect(await store.load()).toBeNull();
  });

  it("returns null when the saved object lacks required fields", async () => {
    const path = join(dir, "vapid.json");
    await writeFile(path, JSON.stringify({ publicKey: "PUB" }), "utf-8");
    const store = createVapidStore({ path });
    expect(await store.load()).toBeNull();
  });

  it("creates the parent directory if it does not exist", async () => {
    const path = join(dir, "nested", "vapid.json");
    const store = createVapidStore({ path });
    await store.save({ publicKey: "PUB", privateKey: "PRIV" });
    const onDisk = JSON.parse(await readFile(path, "utf-8"));
    expect(onDisk.publicKey).toBe("PUB");
  });
});
