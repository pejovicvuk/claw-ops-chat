import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as manager from "./manager";

/**
 * Manager spawns real `node -e '...'` processes — no npm needed. We
 * pass `cwdOverride` to short-circuit `itemDir` resolution so each
 * test runs against its own scratch folder.
 */

afterEach(async () => {
  for (const s of manager.list()) {
    await manager.stop(s.id);
  }
  manager.killAll();
});

function makeTempItem(): string {
  const tmp = mkdtempSync(join(tmpdir(), "claw-mgr-"));
  // Minimal package.json so detectFramework returns node-script.
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      scripts: { dev: "node -e 'setInterval(()=>{},1000)'" },
    }),
  );
  return tmp;
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor: predicate never became true");
}

describe("dev-server manager", () => {
  it("spawns and tracks a dev server", async () => {
    const tmp = makeTempItem();

    const s = await manager.start({
      projectSlug: "p",
      itemSlug: "i",
      port: 3000,
      actorEmail: "test@example.com",
      cwdOverride: tmp,
      runSpecOverride: {
        command: "node",
        args: ["-e", "setInterval(()=>{}, 1000); console.log('listening on 3000')"],
        env: {},
      },
    });

    expect(s.id).toBe("p/i/3000");
    expect(s.framework).toBe("node-script");
    expect(s.pid).toBeGreaterThan(0);
    expect(s.actorEmail).toBe("test@example.com");

    expect(manager.list()).toHaveLength(1);
    expect(manager.get(s.id)?.id).toBe(s.id);
    expect(manager.getByPort("p", "i", 3000)?.id).toBe(s.id);

    rmSync(tmp, { recursive: true, force: true });
  });

  it("captures stdout into the lastLogs ring buffer + sets readyAt on a known signal", async () => {
    const tmp = makeTempItem();

    await manager.start({
      projectSlug: "p",
      itemSlug: "i",
      port: 3000,
      actorEmail: "t@example.com",
      cwdOverride: tmp,
      runSpecOverride: {
        command: "node",
        args: ["-e", "console.log('Local: http://localhost:3000'); setInterval(()=>{},1000)"],
        env: {},
      },
    });

    await waitFor(() => {
      const s = manager.getByPort("p", "i", 3000);
      return !!s && s.readyAt !== null;
    });

    const s = manager.getByPort("p", "i", 3000);
    expect(s?.readyAt).toBeTypeOf("number");
    expect(s?.lastLogs.some((l) => l.includes("Local: http://localhost:3000"))).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns the existing server when start is called twice for the same id", async () => {
    const tmp = makeTempItem();

    const s1 = await manager.start({
      projectSlug: "p",
      itemSlug: "i",
      port: 3000,
      actorEmail: "t@example.com",
      cwdOverride: tmp,
      runSpecOverride: {
        command: "node",
        args: ["-e", "setInterval(()=>{},1000)"],
        env: {},
      },
    });
    const s2 = await manager.start({
      projectSlug: "p",
      itemSlug: "i",
      port: 3000,
      actorEmail: "t@example.com",
      cwdOverride: tmp,
      runSpecOverride: {
        command: "node",
        args: ["-e", "setInterval(()=>{},1000)"],
        env: {},
      },
    });

    expect(s1.pid).toBe(s2.pid);
    expect(manager.list()).toHaveLength(1);

    rmSync(tmp, { recursive: true, force: true });
  });

  it("stops a running server cleanly", async () => {
    const tmp = makeTempItem();

    const s = await manager.start({
      projectSlug: "p",
      itemSlug: "i",
      port: 3000,
      actorEmail: "t@example.com",
      cwdOverride: tmp,
      runSpecOverride: {
        command: "node",
        args: ["-e", "setInterval(()=>{},1000)"],
        env: {},
      },
    });

    const result = await manager.stop(s.id);
    expect(result.exitCode).not.toBeUndefined();
    await waitFor(() => manager.get(s.id) === null);
    expect(manager.list()).toHaveLength(0);

    rmSync(tmp, { recursive: true, force: true });
  });

  it("stop on a missing id is a no-op", async () => {
    const r = await manager.stop("does/not/exist/9999");
    expect(r.exitCode).toBeNull();
  });

  it("notifies subscribers on start + stop", async () => {
    const tmp = makeTempItem();

    let lastSnapshot = manager.list();
    const unsub = manager.subscribe((s) => {
      lastSnapshot = s;
    });

    const started = await manager.start({
      projectSlug: "p",
      itemSlug: "i",
      port: 3000,
      actorEmail: "t@example.com",
      cwdOverride: tmp,
      runSpecOverride: {
        command: "node",
        args: ["-e", "setInterval(()=>{},1000)"],
        env: {},
      },
    });
    expect(lastSnapshot.find((s) => s.id === started.id)).toBeTruthy();

    await manager.stop(started.id);
    await waitFor(() => lastSnapshot.find((s) => s.id === started.id) === undefined);

    unsub();
    rmSync(tmp, { recursive: true, force: true });
  });
});
