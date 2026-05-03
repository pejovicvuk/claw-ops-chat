import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOWNLOAD_TTL_MS,
  MAX_CONCURRENT_PER_WS,
  MAX_DOWNLOAD_BYTES,
  MAX_TOTAL_DOWNLOAD_BYTES,
  _downloadsCount,
  _resetDownloadsForTests,
  cancelDownload,
  clearInFlight,
  getDownload,
  markInFlight,
  pickDownloadId,
  registerDownload,
  validateUuid,
  type DownloadHandle,
} from "../download-relay";

function makeHandle(): DownloadHandle & { canceled: boolean; deleted: boolean } {
  const h: DownloadHandle & { canceled: boolean; deleted: boolean } = {
    canceled: false,
    deleted: false,
    async cancel() {
      h.canceled = true;
    },
    async delete() {
      h.deleted = true;
    },
  };
  return h;
}

describe("validateUuid", () => {
  it("accepts a normal UUID v4", () => {
    expect(validateUuid("11111111-2222-3333-4444-555555555555")).toBe(true);
  });
  it("accepts a 32-char hex with no dashes", () => {
    expect(validateUuid("0123456789abcdef0123456789abcdef")).toBe(true);
  });
  it("rejects non-strings", () => {
    expect(validateUuid(undefined)).toBe(false);
    expect(validateUuid(null)).toBe(false);
    expect(validateUuid(42)).toBe(false);
    expect(validateUuid({})).toBe(false);
  });
  it("rejects path-traversal payloads", () => {
    // SECURITY: blocks attacker-controlled ids from escaping DOWNLOAD_DIR.
    expect(validateUuid("../../etc/passwd")).toBe(false);
    expect(validateUuid("foo/bar")).toBe(false);
    expect(validateUuid("foo\\bar")).toBe(false);
  });
  it("rejects null bytes", () => {
    expect(validateUuid("aaaa\0bbbb-1234-5678-9abc-def012345678")).toBe(false);
  });
  it("rejects too short / too long", () => {
    expect(validateUuid("short")).toBe(false);
    expect(validateUuid("a".repeat(100))).toBe(false);
  });
});

describe("pickDownloadId", () => {
  it("returns a UUID v4 shape", () => {
    const id = pickDownloadId();
    expect(validateUuid(id)).toBe(true);
    // RFC 4122 v4 has the literal "-4" at chars 14-15 (version nibble).
    // node:crypto.randomUUID emits v4 specifically.
    expect(id[14]).toBe("4");
  });
  it("returns unique ids on each call", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(pickDownloadId());
    expect(ids.size).toBe(100);
  });
});

describe("constants", () => {
  it("per-file cap is 500 MiB", () => {
    expect(MAX_DOWNLOAD_BYTES).toBe(500 * 1024 * 1024);
  });
  it("total-dir cap is 2 GiB", () => {
    expect(MAX_TOTAL_DOWNLOAD_BYTES).toBe(2 * 1024 * 1024 * 1024);
  });
  it("per-WS concurrent cap is 5", () => {
    expect(MAX_CONCURRENT_PER_WS).toBe(5);
  });
  it("TTL is 5 minutes", () => {
    expect(DOWNLOAD_TTL_MS).toBe(5 * 60_000);
  });
});

describe("registerDownload + getDownload", () => {
  beforeEach(() => {
    _resetDownloadsForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    _resetDownloadsForTests();
    vi.useRealTimers();
  });

  it("registers an entry and returns it via getDownload with matching email", () => {
    const handle = makeHandle();
    const entry = registerDownload({
      path: "/tmp/never-touched",
      suggestedFilename: "report.pdf",
      size: 1234,
      actorEmail: "alice@example.com",
      handle,
    });
    expect(validateUuid(entry.id)).toBe(true);
    expect(_downloadsCount()).toBe(1);
    const fetched = getDownload(entry.id, "alice@example.com");
    expect(fetched).toBeTruthy();
    expect(fetched?.suggestedFilename).toBe("report.pdf");
    expect(fetched?.size).toBe(1234);
  });

  it("getDownload returns null on wrong owner email", () => {
    // SECURITY: UUID alone is not enough — wrong actor must get the
    // same null response as no-such-id (avoid leaking "valid id, wrong owner").
    const entry = registerDownload({
      path: "/tmp/x",
      suggestedFilename: "x.txt",
      size: 1,
      actorEmail: "alice@example.com",
      handle: makeHandle(),
    });
    expect(getDownload(entry.id, "mallory@example.com")).toBeNull();
  });

  it("getDownload returns null for unknown id", () => {
    expect(getDownload("11111111-2222-3333-4444-555555555555", "alice@example.com")).toBeNull();
  });

  it("getDownload returns null for invalid UUID shape", () => {
    expect(getDownload("../etc/passwd", "alice@example.com")).toBeNull();
  });

  it("schedules a TTL timer that triggers cancellation", async () => {
    const handle = makeHandle();
    registerDownload({
      path: "/tmp/never",
      suggestedFilename: "x",
      size: 0,
      actorEmail: "a@b",
      handle,
    });
    expect(_downloadsCount()).toBe(1);
    // Advance time past the TTL — the scheduled cancelDownload fires.
    await vi.advanceTimersByTimeAsync(DOWNLOAD_TTL_MS + 100);
    expect(_downloadsCount()).toBe(0);
    expect(handle.canceled).toBe(true);
  });
});

describe("markInFlight + clearInFlight", () => {
  beforeEach(() => {
    _resetDownloadsForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    _resetDownloadsForTests();
    vi.useRealTimers();
  });

  it("markInFlight cancels the pending TTL so the sweeper doesn't race", async () => {
    const entry = registerDownload({
      path: "/tmp/x",
      suggestedFilename: "x",
      size: 0,
      actorEmail: "a@b",
      handle: makeHandle(),
    });
    markInFlight(entry.id);
    // Advance past the TTL; entry should still be there because the
    // timer was cleared.
    await vi.advanceTimersByTimeAsync(DOWNLOAD_TTL_MS + 100);
    expect(_downloadsCount()).toBe(1);
  });

  it("clearInFlight re-arms the TTL", async () => {
    const handle = makeHandle();
    const id = registerDownload({
      path: "/tmp/x",
      suggestedFilename: "x",
      size: 0,
      actorEmail: "a@b",
      handle,
    }).id;
    markInFlight(id);
    clearInFlight(id);
    await vi.advanceTimersByTimeAsync(DOWNLOAD_TTL_MS + 100);
    expect(_downloadsCount()).toBe(0);
    expect(handle.canceled).toBe(true);
  });

  it("markInFlight on unknown id is a no-op", () => {
    expect(() => markInFlight("nonexistent-id-aaaaaaaa")).not.toThrow();
  });
});

describe("cancelDownload", () => {
  beforeEach(() => {
    _resetDownloadsForTests();
  });
  afterEach(() => {
    _resetDownloadsForTests();
  });

  it("removes the entry and calls handle.cancel + delete", async () => {
    const handle = makeHandle();
    const entry = registerDownload({
      path: "/tmp/never-exists",
      suggestedFilename: "x",
      size: 0,
      actorEmail: "a@b",
      handle,
    });
    expect(_downloadsCount()).toBe(1);
    await cancelDownload(entry.id);
    expect(_downloadsCount()).toBe(0);
    expect(handle.canceled).toBe(true);
    expect(handle.deleted).toBe(true);
  });

  it("is idempotent on already-cancelled id", async () => {
    const entry = registerDownload({
      path: "/tmp/x",
      suggestedFilename: "x",
      size: 0,
      actorEmail: "a@b",
      handle: makeHandle(),
    });
    await cancelDownload(entry.id);
    // Second call shouldn't throw or count weirdly.
    await expect(cancelDownload(entry.id)).resolves.toBeUndefined();
  });

  it("is a no-op on unknown id", async () => {
    await expect(cancelDownload("nonexistent-id-aaaaaaaa")).resolves.toBeUndefined();
  });
});
