// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const extractSessionMock = vi.fn();
vi.mock("@/lib/auth-server", () => ({
  extractSession: () => extractSessionMock(),
  unauthorized: () => Response.json({ error: "Unauthorized" }, { status: 401 }),
}));

const loadRateLimitsMock = vi.fn();
vi.mock("@/lib/account-rate-limits", () => ({
  loadRateLimits: () => loadRateLimitsMock(),
}));

const probeRateLimitsMock = vi.fn();
vi.mock("@/lib/rate-limit-probe", () => ({
  probeRateLimits: () => probeRateLimitsMock(),
}));

async function callGet(): Promise<Response> {
  const { GET } = await import("./route");
  return GET(new Request("http://localhost/api/rate-limits"));
}

async function resetProbeKicker(): Promise<void> {
  const mod = await import("./route");
  mod.__resetProbeKickerForTests();
}

beforeEach(async () => {
  extractSessionMock.mockReset();
  loadRateLimitsMock.mockReset();
  probeRateLimitsMock.mockReset();
  probeRateLimitsMock.mockResolvedValue({ applied: 0, httpStatus: 200 });
  await resetProbeKicker();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/api/rate-limits GET", () => {
  it("rejects unauthenticated requests with 401", async () => {
    extractSessionMock.mockReturnValue(null);
    loadRateLimitsMock.mockResolvedValue({ updatedAt: null, windows: {} });
    const res = await callGet();
    expect(res.status).toBe(401);
    expect(probeRateLimitsMock).not.toHaveBeenCalled();
  });

  it("returns the cache and kicks a probe when updatedAt is null (never probed)", async () => {
    extractSessionMock.mockReturnValue({ email: "u@x.com" });
    loadRateLimitsMock.mockResolvedValue({ updatedAt: null, windows: {} });
    const res = await callGet();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updatedAt: null, windows: {} });
    expect(probeRateLimitsMock).toHaveBeenCalledOnce();
  });

  it("kicks a probe when the cache is older than 30s", async () => {
    extractSessionMock.mockReturnValue({ email: "u@x.com" });
    loadRateLimitsMock.mockResolvedValue({
      updatedAt: Date.now() - 60_000,
      windows: { five_hour: { status: "allowed", utilization: 0.18, resetsAt: null } },
    });
    const res = await callGet();
    expect(res.status).toBe(200);
    expect(probeRateLimitsMock).toHaveBeenCalledOnce();
  });

  it("does NOT kick a probe when the cache is fresh (under 30s)", async () => {
    extractSessionMock.mockReturnValue({ email: "u@x.com" });
    loadRateLimitsMock.mockResolvedValue({
      updatedAt: Date.now() - 5_000,
      windows: { five_hour: { status: "allowed", utilization: 0.18, resetsAt: null } },
    });
    const res = await callGet();
    expect(res.status).toBe(200);
    expect(probeRateLimitsMock).not.toHaveBeenCalled();
  });

  it("debounces concurrent stale-cache GETs into a single probe", async () => {
    extractSessionMock.mockReturnValue({ email: "u@x.com" });
    loadRateLimitsMock.mockResolvedValue({
      updatedAt: Date.now() - 60_000,
      windows: {},
    });
    // Three near-simultaneous requests must only trigger one probe — the
    // in-flight guard protects Anthropic from a thundering herd when the
    // user mashes refresh.
    await Promise.all([callGet(), callGet(), callGet()]);
    expect(probeRateLimitsMock).toHaveBeenCalledOnce();
  });

  it("returns the cache immediately without awaiting the probe", async () => {
    extractSessionMock.mockReturnValue({ email: "u@x.com" });
    loadRateLimitsMock.mockResolvedValue({
      updatedAt: Date.now() - 60_000,
      windows: { five_hour: { status: "allowed", utilization: 0.18, resetsAt: 123 } },
    });
    // Probe takes "forever" — the response must still come back fast,
    // because the GET cannot block on a network call to Anthropic.
    let resolveProbe: (() => void) | null = null;
    probeRateLimitsMock.mockImplementation(
      () => new Promise<void>((r) => (resolveProbe = () => r())),
    );

    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.windows.five_hour.utilization).toBe(0.18);
    expect(probeRateLimitsMock).toHaveBeenCalledOnce();
    // Drain the dangling promise so it doesn't bleed into the next test.
    if (resolveProbe) (resolveProbe as () => void)();
  });

  it("swallows probe rejections so the GET never errors", async () => {
    extractSessionMock.mockReturnValue({ email: "u@x.com" });
    loadRateLimitsMock.mockResolvedValue({ updatedAt: null, windows: {} });
    probeRateLimitsMock.mockRejectedValue(new Error("boom"));
    const res = await callGet();
    expect(res.status).toBe(200);
  });
});
