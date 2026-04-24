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

  it("writes both five_hour and seven_day windows from a single response", async () => {
    await writeCreds("t");
    mockFetch({
      status: 200,
      headers: {
        "anthropic-ratelimit-unified-status": "allowed_warning",
        "anthropic-ratelimit-unified-reset": "2100-01-01T00:00:00Z",
      },
    });
    const result = await probeRateLimits();
    expect(result.applied).toBe(2);
    const cache = await loadRateLimits();
    expect(cache.windows.five_hour?.status).toBe("allowed_warning");
    expect(cache.windows.seven_day?.status).toBe("allowed_warning");
    expect(cache.windows.five_hour?.resetsAt).toBe(Date.parse("2100-01-01T00:00:00Z"));
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
