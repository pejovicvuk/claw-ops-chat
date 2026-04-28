import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPushStore } from "./store";
import type { PushSubscriptionInput } from "./types";

const sub = (endpoint: string): PushSubscriptionInput => ({
  endpoint,
  keys: { p256dh: `p_${endpoint}`, auth: `a_${endpoint}` },
});

describe("PushStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "push-store-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("starts empty when the file does not exist", async () => {
    const store = createPushStore({ path: join(dir, "subs.json") });
    expect(await store.list("a@x.com")).toEqual([]);
  });

  it("upserts one device and lists it back", async () => {
    const store = createPushStore({ path: join(dir, "subs.json") });
    const rec = await store.upsert("a@x.com", sub("https://push/aaa"), "Chrome on macOS");
    expect(rec.id).toMatch(/^[0-9a-f]{16}$/);
    expect(rec.endpoint).toBe("https://push/aaa");
    expect(rec.label).toBe("Chrome on macOS");
    expect(rec.events.turnComplete).toBe(true);
    const list = await store.list("a@x.com");
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(rec.id);
  });

  it("dedupes by endpoint via stable id", async () => {
    const store = createPushStore({ path: join(dir, "subs.json") });
    const r1 = await store.upsert("a@x.com", sub("https://push/x"), "Chrome");
    const r2 = await store.upsert("a@x.com", sub("https://push/x"), "Chrome (re-registered)");
    expect(r1.id).toBe(r2.id);
    const list = await store.list("a@x.com");
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe("Chrome (re-registered)");
  });

  it("isolates devices across users", async () => {
    const store = createPushStore({ path: join(dir, "subs.json") });
    await store.upsert("a@x.com", sub("https://push/a"), "A");
    await store.upsert("b@x.com", sub("https://push/b"), "B");
    expect(await store.list("a@x.com")).toHaveLength(1);
    expect(await store.list("b@x.com")).toHaveLength(1);
    expect((await store.list("a@x.com"))[0].endpoint).toBe("https://push/a");
  });

  it("updates per-event preferences", async () => {
    const store = createPushStore({ path: join(dir, "subs.json") });
    const rec = await store.upsert("a@x.com", sub("https://push/x"), "Phone");
    const updated = await store.updatePreferences("a@x.com", rec.id, {
      events: { turnComplete: false, error: false },
    });
    expect(updated?.events.turnComplete).toBe(false);
    expect(updated?.events.error).toBe(false);
    expect(updated?.events.permissionRequest).toBe(true);
  });

  it("removes by id and by endpoint", async () => {
    const store = createPushStore({ path: join(dir, "subs.json") });
    const r1 = await store.upsert("a@x.com", sub("https://push/aa"), "A");
    await store.upsert("a@x.com", sub("https://push/bb"), "B");
    expect(await store.remove("a@x.com", r1.id)).toBe(true);
    expect(await store.list("a@x.com")).toHaveLength(1);
    await store.removeByEndpoint("https://push/bb");
    expect(await store.list("a@x.com")).toHaveLength(0);
  });

  it("clear() drops all devices for a user", async () => {
    const store = createPushStore({ path: join(dir, "subs.json") });
    await store.upsert("a@x.com", sub("https://push/aa"), "A");
    await store.upsert("a@x.com", sub("https://push/bb"), "B");
    expect(await store.clear("a@x.com")).toBe(2);
    expect(await store.list("a@x.com")).toHaveLength(0);
  });

  it("clearAllAcrossUsers() drops every device for every user", async () => {
    const path = join(dir, "subs.json");
    const store = createPushStore({ path });
    await store.upsert("a@x.com", sub("https://push/aa"), "A");
    await store.upsert("a@x.com", sub("https://push/bb"), "B");
    await store.upsert("c@x.com", sub("https://push/cc"), "C");
    expect(await store.clearAllAcrossUsers()).toBe(3);
    expect(await store.list("a@x.com")).toHaveLength(0);
    expect(await store.list("c@x.com")).toHaveLength(0);
    // Persists the empty state so the next instance also sees zero.
    const fresh = createPushStore({ path });
    expect(await fresh.list("a@x.com")).toHaveLength(0);
  });

  it("clearAllAcrossUsers() returns 0 when there is nothing to clear", async () => {
    const store = createPushStore({ path: join(dir, "subs.json") });
    expect(await store.clearAllAcrossUsers()).toBe(0);
  });

  it("persists across instances", async () => {
    const path = join(dir, "subs.json");
    const a = createPushStore({ path });
    await a.upsert("a@x.com", sub("https://push/x"), "Chrome");
    const b = createPushStore({ path });
    const list = await b.list("a@x.com");
    expect(list).toHaveLength(1);
    expect(list[0].endpoint).toBe("https://push/x");
  });

  it("forUserWithEvent filters devices that opted out of an event", async () => {
    const store = createPushStore({ path: join(dir, "subs.json") });
    const r1 = await store.upsert("a@x.com", sub("https://push/aa"), "A");
    await store.upsert("a@x.com", sub("https://push/bb"), "B");
    await store.updatePreferences("a@x.com", r1.id, { events: { turnComplete: false } });
    const seen: string[] = [];
    await store.forUserWithEvent("a@x.com", "turnComplete", (d) => seen.push(d.endpoint));
    expect(seen).toEqual(["https://push/bb"]);
  });

  it("listSummary scrubs endpoint and keys", async () => {
    const store = createPushStore({ path: join(dir, "subs.json") });
    await store.upsert("a@x.com", sub("https://push/secret"), "Mac");
    const summary = await store.listSummary("a@x.com", "https://push/secret");
    expect(summary).toHaveLength(1);
    expect(summary[0].isThisDevice).toBe(true);
    expect(JSON.stringify(summary[0])).not.toContain("https://push/secret");
    expect(JSON.stringify(summary[0])).not.toContain("p_");
  });

  it("upsert applies smartChat as the default focus behavior", async () => {
    const store = createPushStore({ path: join(dir, "subs.json") });
    const rec = await store.upsert("a@x.com", sub("https://push/x"), "Mac");
    expect(rec.behavior.focusBehavior).toBe("smartChat");
  });

  it("upsert accepts and merges partial behavior", async () => {
    const store = createPushStore({ path: join(dir, "subs.json") });
    const rec = await store.upsert("a@x.com", sub("https://push/x"), "Mac", undefined, {
      focusBehavior: "alwaysShow",
    });
    expect(rec.behavior.focusBehavior).toBe("alwaysShow");
    const re = await store.upsert("a@x.com", sub("https://push/x"), "Mac");
    expect(re.behavior.focusBehavior).toBe("alwaysShow");
  });

  it("updatePreferences patches behavior without disturbing events", async () => {
    const store = createPushStore({ path: join(dir, "subs.json") });
    const rec = await store.upsert("a@x.com", sub("https://push/x"), "Mac");
    const updated = await store.updatePreferences("a@x.com", rec.id, {
      behavior: { focusBehavior: "suppress" },
    });
    expect(updated?.behavior.focusBehavior).toBe("suppress");
    expect(updated?.events.turnComplete).toBe(true);
  });

  it("listSummary exposes behavior", async () => {
    const store = createPushStore({ path: join(dir, "subs.json") });
    await store.upsert("a@x.com", sub("https://push/x"), "Mac", undefined, {
      focusBehavior: "alwaysShow",
    });
    const summary = await store.listSummary("a@x.com");
    expect(summary[0].behavior.focusBehavior).toBe("alwaysShow");
  });

  it("backfills missing behavior when loading a legacy JSON file and persists", async () => {
    const path = join(dir, "subs.json");
    await writeFile(
      path,
      JSON.stringify({
        "a@x.com": [
          {
            id: "abc1234567890def",
            endpoint: "https://push/x",
            keys: { p256dh: "p", auth: "a" },
            label: "Legacy Chrome",
            createdAt: 1,
            lastSeenAt: 1,
            events: {
              turnComplete: true,
              permissionRequest: true,
              error: true,
              cronComplete: true,
              monitoringAlert: true,
            },
          },
        ],
      }),
      "utf-8",
    );
    const store = createPushStore({ path });
    const list = await store.list("a@x.com");
    expect(list[0].behavior.focusBehavior).toBe("smartChat");
    const onDisk = JSON.parse(await readFile(path, "utf-8"));
    expect(onDisk["a@x.com"][0].behavior.focusBehavior).toBe("smartChat");
  });
});
