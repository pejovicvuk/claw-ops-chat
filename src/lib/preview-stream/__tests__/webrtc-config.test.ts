import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_STUN_URLS,
  getIceServers,
  getRtcConfig,
  getRtcConnectTimeoutMs,
} from "../webrtc-config";

describe("getIceServers", () => {
  it("falls back to the public Google STUN servers when no env is set", () => {
    const servers = getIceServers({});
    expect(servers).toHaveLength(1);
    expect(servers[0].urls).toEqual([...DEFAULT_STUN_URLS]);
  });

  it("parses a comma-separated WEBRTC_STUN_URLS", () => {
    const servers = getIceServers({
      WEBRTC_STUN_URLS: "stun:stun.example.com:3478 , stun:stun2.example.com",
    });
    expect(servers[0].urls).toEqual(["stun:stun.example.com:3478", "stun:stun2.example.com"]);
  });

  it("ignores entries that don't have stun:/stuns: scheme — defense against accidental http://", () => {
    const servers = getIceServers({
      WEBRTC_STUN_URLS: "http://evil.example.com,stun:ok.example.com",
    });
    expect(servers[0].urls).toEqual(["stun:ok.example.com"]);
  });

  it("falls back to defaults when the env var contains only invalid entries", () => {
    const servers = getIceServers({
      WEBRTC_STUN_URLS: "http://nope, ftp://also-nope",
    });
    expect(servers[0].urls).toEqual([...DEFAULT_STUN_URLS]);
  });

  it("appends a TURN entry when WEBRTC_TURN_URL + credentials are all present", () => {
    const servers = getIceServers({
      WEBRTC_TURN_URL: "turn:turn.example.com:3478",
      WEBRTC_TURN_USERNAME: "u",
      WEBRTC_TURN_PASSWORD: "p",
    });
    expect(servers).toHaveLength(2);
    expect(servers[1]).toEqual({
      urls: "turn:turn.example.com:3478",
      username: "u",
      credential: "p",
    });
  });

  it("skips TURN when any of url/username/password are missing", () => {
    const noUser = getIceServers({
      WEBRTC_TURN_URL: "turn:t.example.com",
      WEBRTC_TURN_PASSWORD: "p",
    });
    expect(noUser).toHaveLength(1);
    const noPass = getIceServers({
      WEBRTC_TURN_URL: "turn:t.example.com",
      WEBRTC_TURN_USERNAME: "u",
    });
    expect(noPass).toHaveLength(1);
  });

  it("rejects a TURN url with a non-turn scheme", () => {
    const servers = getIceServers({
      WEBRTC_TURN_URL: "stun:imposter.example.com",
      WEBRTC_TURN_USERNAME: "u",
      WEBRTC_TURN_PASSWORD: "p",
    });
    expect(servers).toHaveLength(1);
  });
});

describe("getRtcConnectTimeoutMs", () => {
  it("returns the default when unset", () => {
    expect(getRtcConnectTimeoutMs({})).toBe(DEFAULT_CONNECT_TIMEOUT_MS);
  });

  it("respects an in-range override", () => {
    expect(getRtcConnectTimeoutMs({ WEBRTC_CONNECT_TIMEOUT_MS: "12000" })).toBe(12_000);
  });

  it("clamps absurdly small or large values to the default", () => {
    expect(getRtcConnectTimeoutMs({ WEBRTC_CONNECT_TIMEOUT_MS: "10" })).toBe(
      DEFAULT_CONNECT_TIMEOUT_MS,
    );
    expect(getRtcConnectTimeoutMs({ WEBRTC_CONNECT_TIMEOUT_MS: "9999999" })).toBe(
      DEFAULT_CONNECT_TIMEOUT_MS,
    );
  });

  it("falls back to the default on garbage input", () => {
    expect(getRtcConnectTimeoutMs({ WEBRTC_CONNECT_TIMEOUT_MS: "later" })).toBe(
      DEFAULT_CONNECT_TIMEOUT_MS,
    );
  });
});

describe("getRtcConfig", () => {
  it("bundles iceServers + connectTimeoutMs", () => {
    const cfg = getRtcConfig({});
    expect(cfg.iceServers[0].urls).toEqual([...DEFAULT_STUN_URLS]);
    expect(cfg.connectTimeoutMs).toBe(DEFAULT_CONNECT_TIMEOUT_MS);
  });
});
