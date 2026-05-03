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

describe("chromium-pool prelaunch", () => {
  it("seeds extra launch args before the first acquirePage", async () => {
    prelaunch([
      "--auto-select-desktop-capture-source=Current Tab",
      "--use-fake-ui-for-media-stream",
    ]);
    await acquirePage(3000);
    expect(launchSpy).toHaveBeenCalledOnce();
    const args = launchSpy.mock.calls[0][0].args as string[];
    expect(args).toContain("--auto-select-desktop-capture-source=Current Tab");
    expect(args).toContain("--use-fake-ui-for-media-stream");
  });

  it("keeps the existing Phase 1–3 baseline flags alongside the extras", async () => {
    prelaunch(["--phase4-flag"]);
    await acquirePage(3000);
    const args = launchSpy.mock.calls[0][0].args as string[];
    expect(args).toContain("--no-sandbox");
    expect(args).toContain("--disable-gpu");
    expect(args).toContain("--autoplay-policy=no-user-gesture-required");
    expect(args).toContain("--phase4-flag");
  });

  it("is a noop when called after the browser has launched", async () => {
    await acquirePage(3000);
    prelaunch(["--too-late-flag"]);
    // First launch already happened — second acquirePage reuses it,
    // so launchSpy is still only called once.
    await acquirePage(3001);
    expect(launchSpy).toHaveBeenCalledOnce();
    const args = launchSpy.mock.calls[0][0].args as string[];
    expect(args).not.toContain("--too-late-flag");
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
