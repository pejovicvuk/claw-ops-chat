import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Hoisted spies so the playwright-core mock can reference them without
// the module-evaluation-order pitfall that vi.mock has with let-bound
// closures.
const { launchSpy, gotoSpy } = vi.hoisted(() => ({
  launchSpy: vi.fn(),
  gotoSpy: vi.fn(),
}));

vi.mock("playwright-core", () => ({
  chromium: {
    launch: (opts: { args: string[] }) => {
      launchSpy(opts);
      return Promise.resolve({
        newContext: async () => ({
          newPage: async () => ({
            goto: (url: string) => {
              gotoSpy(url);
              return Promise.resolve();
            },
          }),
          close: async () => {},
        }),
        close: async () => {},
      });
    },
  },
}));

import { _resetForTests, acquirePage, prelaunch } from "../chromium-pool";

beforeEach(() => {
  launchSpy.mockClear();
  gotoSpy.mockClear();
  _resetForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("chromium-pool always-on WebRTC flags", () => {
  it("includes the WebRTC media flags on every launch — no prelaunch call needed", async () => {
    await acquirePage(3000);
    expect(launchSpy).toHaveBeenCalledOnce();
    const args = launchSpy.mock.calls[0][0].args as string[];
    expect(args).toContain("--use-fake-ui-for-media-stream");
    expect(args).toContain("--auto-select-desktop-capture-source=Current Tab");
    expect(args).toContain("--enable-features=DesktopCaptureMacV2");
  });

  it("does NOT include --allow-running-insecure-content (dropped for security)", async () => {
    await acquirePage(3000);
    const args = launchSpy.mock.calls[0][0].args as string[];
    expect(args).not.toContain("--allow-running-insecure-content");
  });

  it("keeps the existing Phase 1–3 baseline flags alongside the WebRTC flags", async () => {
    await acquirePage(3000);
    const args = launchSpy.mock.calls[0][0].args as string[];
    expect(args).toContain("--no-sandbox");
    expect(args).toContain("--disable-gpu");
    expect(args).toContain("--autoplay-policy=no-user-gesture-required");
  });

  it("prelaunch() is a deprecated noop shim — extra args still merge but are not required", async () => {
    prelaunch(["--legacy-extra-flag"]);
    await acquirePage(3000);
    const args = launchSpy.mock.calls[0][0].args as string[];
    expect(args).toContain("--legacy-extra-flag");
    // WebRTC flags are still present even though prelaunch was called
    // with a totally different flag set — they're always-on now.
    expect(args).toContain("--use-fake-ui-for-media-stream");
  });
});

describe("acquirePage targetUrl", () => {
  it("navigates to localhost:<port> when no override is given (Phase 1–3 default)", async () => {
    await acquirePage(4321);
    expect(gotoSpy).toHaveBeenCalledWith("http://127.0.0.1:4321/");
  });

  it("navigates to the override URL when targetUrl is provided", async () => {
    const ctrl = "http://127.0.0.1:3100/chat/preview-controller?port=4321&room=abc";
    await acquirePage(4321, { targetUrl: ctrl });
    expect(gotoSpy).toHaveBeenCalledWith(ctrl);
    expect(gotoSpy).not.toHaveBeenCalledWith("http://127.0.0.1:4321/");
  });
});
