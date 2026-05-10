import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fakeHome: string;

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), "claude-home-"));
  vi.resetModules();
  // Force `homedir()` to point at our temp dir for the duration of the test.
  vi.doMock("os", async () => {
    const real = await vi.importActual<typeof import("os")>("os");
    return { ...real, homedir: () => fakeHome };
  });
});

afterEach(async () => {
  vi.resetModules();
  vi.doUnmock("os");
  await rm(fakeHome, { recursive: true, force: true });
});

describe("ensureSdkAutoMemoryEnabled", () => {
  it("creates ~/.claude/settings.json with both flags true when absent", async () => {
    const { ensureSdkAutoMemoryEnabled, userSettingsPath } = await import("./sdk-settings");
    await ensureSdkAutoMemoryEnabled();
    const written = JSON.parse(await readFile(userSettingsPath(), "utf-8"));
    expect(written.autoMemoryEnabled).toBe(true);
    expect(written.autoDreamEnabled).toBe(true);
  });

  it("preserves unrelated keys when patching", async () => {
    const { ensureSdkAutoMemoryEnabled, userSettingsPath } = await import("./sdk-settings");
    await mkdir(join(fakeHome, ".claude"), { recursive: true });
    await writeFile(
      userSettingsPath(),
      JSON.stringify({ theme: "dark", existing: { nested: 1 } }),
      "utf-8",
    );

    await ensureSdkAutoMemoryEnabled();

    const written = JSON.parse(await readFile(userSettingsPath(), "utf-8"));
    expect(written.theme).toBe("dark");
    expect(written.existing).toEqual({ nested: 1 });
    expect(written.autoMemoryEnabled).toBe(true);
    expect(written.autoDreamEnabled).toBe(true);
  });

  it("is a no-op when both flags are already true", async () => {
    const { ensureSdkAutoMemoryEnabled, userSettingsPath } = await import("./sdk-settings");
    await mkdir(join(fakeHome, ".claude"), { recursive: true });
    const original = JSON.stringify({ autoMemoryEnabled: true, autoDreamEnabled: true, x: 1 });
    await writeFile(userSettingsPath(), original, "utf-8");

    await ensureSdkAutoMemoryEnabled();

    expect(await readFile(userSettingsPath(), "utf-8")).toBe(original);
  });

  it("recovers from a malformed settings file", async () => {
    const { ensureSdkAutoMemoryEnabled, userSettingsPath } = await import("./sdk-settings");
    await mkdir(join(fakeHome, ".claude"), { recursive: true });
    await writeFile(userSettingsPath(), "not json {", "utf-8");

    await ensureSdkAutoMemoryEnabled();

    const written = JSON.parse(await readFile(userSettingsPath(), "utf-8"));
    expect(written.autoMemoryEnabled).toBe(true);
    expect(written.autoDreamEnabled).toBe(true);
  });
});
