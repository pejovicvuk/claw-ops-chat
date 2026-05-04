import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const previewSpy = vi.fn().mockResolvedValue(undefined);

vi.mock("../audit/writer", () => ({
  getAuditWriter: () => ({
    api: vi.fn().mockResolvedValue(undefined),
    cron: vi.fn().mockResolvedValue(undefined),
    session: vi.fn().mockResolvedValue(undefined),
    alert: vi.fn().mockResolvedValue(undefined),
    preview: previewSpy,
  }),
}));

const {
  tryRegisterPreview,
  getActivePreviews,
  getActivePreviewCount,
  previewMaxActive,
  _resetForTests,
} = await import("./health");

const ORIGINAL_ENV = process.env.PREVIEW_MAX_ACTIVE;

beforeEach(() => {
  _resetForTests();
  previewSpy.mockClear();
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.PREVIEW_MAX_ACTIVE;
  else process.env.PREVIEW_MAX_ACTIVE = ORIGINAL_ENV;
});

describe("preview-stream/health", () => {
  describe("previewMaxActive", () => {
    it("defaults to 4 when env is unset", () => {
      delete process.env.PREVIEW_MAX_ACTIVE;
      expect(previewMaxActive()).toBe(4);
    });

    it("respects PREVIEW_MAX_ACTIVE in valid range", () => {
      process.env.PREVIEW_MAX_ACTIVE = "8";
      expect(previewMaxActive()).toBe(8);
    });

    it("falls back to default for non-numeric values", () => {
      process.env.PREVIEW_MAX_ACTIVE = "not-a-number";
      expect(previewMaxActive()).toBe(4);
    });

    it("falls back to default for out-of-range values", () => {
      process.env.PREVIEW_MAX_ACTIVE = "0";
      expect(previewMaxActive()).toBe(4);
      process.env.PREVIEW_MAX_ACTIVE = "999999";
      expect(previewMaxActive()).toBe(4);
    });
  });

  describe("tryRegisterPreview", () => {
    it("returns a registration handle when below the cap", () => {
      process.env.PREVIEW_MAX_ACTIVE = "2";
      const reg = tryRegisterPreview({
        projectSlug: "p",
        itemSlug: "i",
        port: 3000,
        actorEmail: "u@x",
        codec: "jpeg",
      });
      expect(reg).not.toBeNull();
      expect(getActivePreviewCount()).toBe(1);
      expect(getActivePreviews()[0]?.port).toBe(3000);
    });

    it("rejects registrations once the cap is reached", () => {
      process.env.PREVIEW_MAX_ACTIVE = "2";
      const a = tryRegisterPreview({
        projectSlug: "p",
        itemSlug: "i",
        port: 3000,
        actorEmail: "u@x",
        codec: "jpeg",
      });
      const b = tryRegisterPreview({
        projectSlug: "p",
        itemSlug: "i",
        port: 3001,
        actorEmail: "u@x",
        codec: "jpeg",
      });
      const c = tryRegisterPreview({
        projectSlug: "p",
        itemSlug: "i",
        port: 3002,
        actorEmail: "u@x",
        codec: "jpeg",
      });
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(c).toBeNull();
      expect(getActivePreviewCount()).toBe(2);
    });

    it("frees a slot on unregister so the cap is recoverable", () => {
      process.env.PREVIEW_MAX_ACTIVE = "1";
      const reg = tryRegisterPreview({
        projectSlug: "p",
        itemSlug: "i",
        port: 3000,
        actorEmail: "u@x",
        codec: "jpeg",
      });
      expect(reg).not.toBeNull();
      expect(
        tryRegisterPreview({
          projectSlug: "p",
          itemSlug: "i",
          port: 3001,
          actorEmail: "u@x",
          codec: "jpeg",
        }),
      ).toBeNull();
      reg?.unregister();
      expect(getActivePreviewCount()).toBe(0);
      const reg2 = tryRegisterPreview({
        projectSlug: "p",
        itemSlug: "i",
        port: 3002,
        actorEmail: "u@x",
        codec: "jpeg",
      });
      expect(reg2).not.toBeNull();
    });

    it("emits an `open` audit event on registration", () => {
      process.env.PREVIEW_MAX_ACTIVE = "4";
      tryRegisterPreview({
        projectSlug: "demo",
        itemSlug: "welcome",
        port: 3001,
        actorEmail: "u@x",
        codec: "h264",
      });
      expect(previewSpy).toHaveBeenCalledTimes(1);
      const arg = previewSpy.mock.calls[0]?.[0] as { type: string; subject: string; codec: string };
      expect(arg.type).toBe("open");
      expect(arg.subject).toBe("demo/welcome:3001");
      expect(arg.codec).toBe("h264");
    });

    it("emits a `close` audit event on unregister", () => {
      process.env.PREVIEW_MAX_ACTIVE = "4";
      const reg = tryRegisterPreview({
        projectSlug: "p",
        itemSlug: "i",
        port: 3000,
        actorEmail: "u@x",
        codec: "jpeg",
      });
      previewSpy.mockClear();
      reg?.unregister();
      expect(previewSpy).toHaveBeenCalledTimes(1);
      const arg = previewSpy.mock.calls[0]?.[0] as { type: string };
      expect(arg.type).toBe("close");
    });

    it("emits `resource_kill` and `reconnect` events distinctly", () => {
      process.env.PREVIEW_MAX_ACTIVE = "4";
      const reg = tryRegisterPreview({
        projectSlug: "p",
        itemSlug: "i",
        port: 3000,
        actorEmail: "u@x",
        codec: "jpeg",
      });
      previewSpy.mockClear();
      reg?.recordResourceKill("heartbeat_timeout");
      reg?.recordReconnect("heartbeat_timeout");
      expect(previewSpy).toHaveBeenCalledTimes(2);
      const types = previewSpy.mock.calls.map(
        (c) => (c[0] as { type: string }).type,
      );
      expect(types).toEqual(["resource_kill", "reconnect"]);
    });

    it("recordHeartbeat increments failures and resets on success", () => {
      process.env.PREVIEW_MAX_ACTIVE = "4";
      const reg = tryRegisterPreview({
        projectSlug: "p",
        itemSlug: "i",
        port: 3000,
        actorEmail: "u@x",
        codec: "jpeg",
      });
      reg?.recordHeartbeat(false);
      reg?.recordHeartbeat(false);
      expect(getActivePreviews()[0]?.consecutiveFailures).toBe(2);
      reg?.recordHeartbeat(true);
      expect(getActivePreviews()[0]?.consecutiveFailures).toBe(0);
      expect(getActivePreviews()[0]?.lastHeartbeatAt).not.toBeNull();
    });

    it("recordFrame accumulates frame and byte counts", () => {
      process.env.PREVIEW_MAX_ACTIVE = "4";
      const reg = tryRegisterPreview({
        projectSlug: "p",
        itemSlug: "i",
        port: 3000,
        actorEmail: "u@x",
        codec: "jpeg",
      });
      reg?.recordFrame(1000);
      reg?.recordFrame(500);
      const snap = getActivePreviews()[0];
      expect(snap?.framesSent).toBe(2);
      expect(snap?.bytesSent).toBe(1500);
    });

    it("updateCodec emits a `codec_fallback` event only on actual change", () => {
      process.env.PREVIEW_MAX_ACTIVE = "4";
      const reg = tryRegisterPreview({
        projectSlug: "p",
        itemSlug: "i",
        port: 3000,
        actorEmail: "u@x",
        codec: "h264",
      });
      previewSpy.mockClear();
      reg?.updateCodec("h264"); // no-op
      expect(previewSpy).not.toHaveBeenCalled();
      reg?.updateCodec("jpeg");
      expect(previewSpy).toHaveBeenCalledTimes(1);
      const arg = previewSpy.mock.calls[0]?.[0] as { type: string };
      expect(arg.type).toBe("codec_fallback");
    });
  });
});
