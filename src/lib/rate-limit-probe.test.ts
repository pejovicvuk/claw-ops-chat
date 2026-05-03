import { mkdtempSync, rmSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { probeRateLimits } from "./rate-limit-probe";
import { __resetForTests, loadRateLimits } from "./account-rate-limits";

let workHome = "";
const originalHome = process.env.HOME;
const originalEnvToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;

beforeEach(() => {
  workHome = mkdtempSync(join(tmpdir(), "rate-limit-probe-"));
  process.env.HOME = workHome;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  __resetForTests();
});

afterEach(() => {
  if (workHome) rmSync(workHome, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalEnvToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  else process.env.CLAUDE_CODE_OAUTH_TOKEN = originalEnvToken;
  vi.restoreAllMocks();
  __resetForTests();
});

async function writeCreds(token: string) {
  await mkdir(join(workHome, ".claude"), { recursive: true });
  await writeFile(
    join(workHome, ".claude", ".credentials.json"),
    JSON.stringify({ claudeAiOauth: { accessToken: token } }),
    "utf-8",
  );
}

function mockFetch(response: { status: number; headers: Record<string, string> }) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("{}", { status: response.status, headers: response.headers }));
}

describe("probeRateLimits", () => {
  it("returns zeros when no token is available", async () => {
    const result = await probeRateLimits();
    expect(result).toEqual({ applied: 0, httpStatus: 0 });
  });

  it("reads token from env var with precedence over credentials file", async () => {
    await writeCreds("from-file");
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "from-env";
    const spy = mockFetch({
      status: 200,
      headers: {
        "anthropic-ratelimit-unified-status": "allowed",
        "anthropic-ratelimit-unified-reset": "2100-01-01T00:00:00Z",
      },
    });
    await probeRateLimits();
    expect(spy).toHaveBeenCalledOnce();
    const callArgs = spy.mock.calls[0];
    const init = callArgs[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer from-env");
  });

  it("legacy bare-unified headers still write five_hour only (no fabricated seven_day)", async () => {
    // Older Anthropic responses (and some endpoints) only emit the bare
    // `unified-status` / `unified-reset` pair, which represents a single
    // window we can't identify. We fall back to writing five_hour and
    // leave seven_day for the SDK's `rate_limit_event` stream.
    await writeCreds("t");
    mockFetch({
      status: 200,
      headers: {
        "anthropic-ratelimit-unified-status": "allowed_warning",
        "anthropic-ratelimit-unified-reset": "2100-01-01T00:00:00Z",
      },
    });
    const result = await probeRateLimits();
    expect(result.applied).toBe(1);
    const cache = await loadRateLimits();
    expect(cache.windows.five_hour?.status).toBe("allowed_warning");
    expect(cache.windows.five_hour?.resetsAt).toBe(Date.parse("2100-01-01T00:00:00Z"));
    expect(cache.windows.seven_day).toBeUndefined();
  });

  it("per-window headers populate five_hour and seven_day with utilization", async () => {
    // The fix for "HUD stuck at 95%": Anthropic returns per-window
    // headers (5h-*, 7d-*) that include utilization. The probe must
    // read these so the cached percentage tracks reality even when
    // the user isn't actively chatting (chat turns are the only other
    // utilization source via SDK rate_limit_event).
    await writeCreds("t");
    mockFetch({
      status: 200,
      headers: {
        "anthropic-ratelimit-unified-5h-status": "allowed",
        "anthropic-ratelimit-unified-5h-reset": "1777824600",
        "anthropic-ratelimit-unified-5h-utilization": "0.18",
        "anthropic-ratelimit-unified-7d-status": "allowed",
        "anthropic-ratelimit-unified-7d-reset": "1777834800",
        "anthropic-ratelimit-unified-7d-utilization": "0.41",
      },
    });
    const result = await probeRateLimits();
    expect(result.applied).toBe(2);
    const cache = await loadRateLimits();
    expect(cache.windows.five_hour?.status).toBe("allowed");
    expect(cache.windows.five_hour?.utilization).toBeCloseTo(0.18);
    expect(cache.windows.five_hour?.resetsAt).toBe(1_777_824_600_000);
    expect(cache.windows.seven_day?.status).toBe("allowed");
    expect(cache.windows.seven_day?.utilization).toBeCloseTo(0.41);
    expect(cache.windows.seven_day?.resetsAt).toBe(1_777_834_800_000);
  });

  it("per-window utilization OVERWRITES a stale value cached from an earlier event", async () => {
    // Regression guard for the user-visible "stuck at 95%" bug.
    // Without this, the merge in applyRateLimitEvent would preserve
    // the old utilization indefinitely.
    await writeCreds("t");
    const { applyRateLimitEvent } = await import("./account-rate-limits");
    await applyRateLimitEvent({
      rateLimitType: "five_hour",
      status: "allowed",
      utilization: 0.95,
      resetsAt: Date.parse("2100-01-01T00:00:00Z"),
    });
    mockFetch({
      status: 200,
      headers: {
        "anthropic-ratelimit-unified-5h-status": "allowed",
        "anthropic-ratelimit-unified-5h-reset": "2100-02-01T00:00:00Z",
        "anthropic-ratelimit-unified-5h-utilization": "0.18",
      },
    });
    await probeRateLimits();
    const cache = await loadRateLimits();
    expect(cache.windows.five_hour?.utilization).toBeCloseTo(0.18);
  });

  it("includes the overage window as its own entry and stamps isUsingOverage on main windows", async () => {
    await writeCreds("t");
    mockFetch({
      status: 200,
      headers: {
        "anthropic-ratelimit-unified-5h-status": "allowed",
        "anthropic-ratelimit-unified-5h-reset": "2100-01-01T00:00:00Z",
        "anthropic-ratelimit-unified-5h-utilization": "0.50",
        "anthropic-ratelimit-unified-7d-status": "allowed",
        "anthropic-ratelimit-unified-7d-reset": "2100-01-08T00:00:00Z",
        "anthropic-ratelimit-unified-7d-utilization": "0.30",
        "anthropic-ratelimit-unified-overage-status": "allowed",
        "anthropic-ratelimit-unified-overage-reset": "2100-01-01T00:00:00Z",
        "anthropic-ratelimit-unified-overage-utilization": "0.10",
      },
    });
    const result = await probeRateLimits();
    expect(result.applied).toBe(3);
    const cache = await loadRateLimits();
    expect(cache.windows.overage?.utilization).toBeCloseTo(0.1);
    expect(cache.windows.five_hour?.isUsingOverage).toBe(true);
    expect(cache.windows.seven_day?.isUsingOverage).toBe(true);
    // Overage window itself doesn't carry the derived flag.
    expect(cache.windows.overage?.isUsingOverage).toBeUndefined();
  });

  it("isUsingOverage is false when the overage window is allowed and at 0%", async () => {
    await writeCreds("t");
    mockFetch({
      status: 200,
      headers: {
        "anthropic-ratelimit-unified-5h-status": "allowed",
        "anthropic-ratelimit-unified-5h-reset": "2100-01-01T00:00:00Z",
        "anthropic-ratelimit-unified-5h-utilization": "0.50",
        "anthropic-ratelimit-unified-overage-status": "allowed",
        "anthropic-ratelimit-unified-overage-reset": "2100-01-01T00:00:00Z",
        "anthropic-ratelimit-unified-overage-utilization": "0.0",
      },
    });
    await probeRateLimits();
    const cache = await loadRateLimits();
    expect(cache.windows.five_hour?.isUsingOverage).toBe(false);
  });

  it("preserves utilization that a prior SDK event wrote under five_hour", async () => {
    await writeCreds("t");
    // Simulate an SDK `rate_limit_event` that landed with a real utilization.
    const { applyRateLimitEvent } = await import("./account-rate-limits");
    await applyRateLimitEvent({
      rateLimitType: "five_hour",
      status: "allowed",
      utilization: 0.42,
      resetsAt: Date.parse("2100-01-01T00:00:00Z"),
    });
    // Probe response has no utilization — older overwrite-semantics
    // would drop it; merge-semantics preserve it.
    mockFetch({
      status: 200,
      headers: {
        "anthropic-ratelimit-unified-status": "allowed",
        "anthropic-ratelimit-unified-reset": "2100-02-01T00:00:00Z",
      },
    });
    await probeRateLimits();
    const cache = await loadRateLimits();
    expect(cache.windows.five_hour?.utilization).toBeCloseTo(0.42);
    // Reset advanced to the newer value though.
    expect(cache.windows.five_hour?.resetsAt).toBe(Date.parse("2100-02-01T00:00:00Z"));
  });

  it("parses the overage header as isUsingOverage", async () => {
    await writeCreds("t");
    mockFetch({
      status: 200,
      headers: {
        "anthropic-ratelimit-unified-status": "allowed",
        "anthropic-ratelimit-unified-reset": "2100-01-01T00:00:00Z",
        "anthropic-ratelimit-unified-overage-status": "allowed_warning",
      },
    });
    await probeRateLimits();
    const cache = await loadRateLimits();
    expect(cache.windows.five_hour?.isUsingOverage).toBe(true);
  });

  it("treats numeric reset as seconds and normalises to ms", async () => {
    await writeCreds("t");
    mockFetch({
      status: 200,
      headers: {
        "anthropic-ratelimit-unified-status": "allowed",
        "anthropic-ratelimit-unified-reset": "1700000000",
      },
    });
    await probeRateLimits();
    const cache = await loadRateLimits();
    expect(cache.windows.five_hour?.resetsAt).toBe(1_700_000_000_000);
  });

  it("returns zeros and does not write when headers are absent", async () => {
    await writeCreds("t");
    mockFetch({
      status: 200,
      headers: {},
    });
    const result = await probeRateLimits();
    expect(result.applied).toBe(0);
    const cache = await loadRateLimits();
    expect(cache.windows).toEqual({});
  });

  it("silently returns zeros on fetch errors", async () => {
    await writeCreds("t");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const result = await probeRateLimits();
    expect(result).toEqual({ applied: 0, httpStatus: 0 });
  });

  it("normalises rejected status", async () => {
    await writeCreds("t");
    mockFetch({
      status: 429,
      headers: {
        "anthropic-ratelimit-unified-status": "rejected",
        "anthropic-ratelimit-unified-reset": "2100-01-01T00:00:00Z",
      },
    });
    await probeRateLimits();
    const cache = await loadRateLimits();
    expect(cache.windows.five_hour?.status).toBe("rejected");
  });

  it("returns httpStatus even when headers are missing", async () => {
    await writeCreds("t");
    mockFetch({ status: 401, headers: {} });
    const result = await probeRateLimits();
    expect(result.httpStatus).toBe(401);
    expect(result.applied).toBe(0);
  });
});
