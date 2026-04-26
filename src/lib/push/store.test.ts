import { mkdtemp, rm } from "fs/promises";
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
});
