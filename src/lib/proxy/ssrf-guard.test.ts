import { describe, it, expect } from "vitest";
import { assertPublicUrl, SsrfError, __INTERNAL } from "./ssrf-guard";

const { isPrivateIp, ipv4InRange } = __INTERNAL;

describe("ipv4InRange", () => {
  it("matches addresses inside a /8", () => {
    expect(ipv4InRange("10.0.0.1", "10.0.0.0", 8)).toBe(true);
    expect(ipv4InRange("10.255.255.255", "10.0.0.0", 8)).toBe(true);
  });

  it("rejects addresses outside a /8", () => {
    expect(ipv4InRange("11.0.0.1", "10.0.0.0", 8)).toBe(false);
  });

  it("handles /12 correctly for 172.16/12", () => {
    expect(ipv4InRange("172.16.0.1", "172.16.0.0", 12)).toBe(true);
    expect(ipv4InRange("172.31.255.255", "172.16.0.0", 12)).toBe(true);
    expect(ipv4InRange("172.32.0.0", "172.16.0.0", 12)).toBe(false);
    expect(ipv4InRange("172.15.255.255", "172.16.0.0", 12)).toBe(false);
  });
});

describe("isPrivateIp", () => {
  it("flags IPv4 private ranges", () => {
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("172.16.5.4")).toBe(true);
    expect(isPrivateIp("192.168.1.1")).toBe(true);
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true); // AWS metadata
    expect(isPrivateIp("100.64.0.1")).toBe(true); // CGNAT
  });

  it("flags IPv6 loopback and private prefixes", () => {
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("fc00::1")).toBe(true);
    expect(isPrivateIp("fd12:3456:789a::1")).toBe(true);
  });

  it("allows public addresses", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
    expect(isPrivateIp("2001:4860:4860::8888")).toBe(false);
  });
});

describe("assertPublicUrl", () => {
  it("rejects non-http(s) schemes", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicUrl("data:text/html,<h1>x</h1>")).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicUrl("javascript:alert(1)")).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicUrl("ftp://example.com")).rejects.toBeInstanceOf(SsrfError);
  });

  it("rejects invalid URLs", async () => {
    await expect(assertPublicUrl("not a url")).rejects.toBeInstanceOf(SsrfError);
  });

  it("rejects local hostnames by name alone", async () => {
    await expect(assertPublicUrl("http://localhost")).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicUrl("http://foo.local")).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicUrl("http://bar.internal")).rejects.toBeInstanceOf(SsrfError);
  });

  it("rejects IPv4 literal in private range without DNS", async () => {
    await expect(assertPublicUrl("http://10.0.0.1", { skipDns: true })).rejects.toBeInstanceOf(
      SsrfError,
    );
    await expect(
      assertPublicUrl("http://169.254.169.254/latest/meta-data/", { skipDns: true }),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it("accepts public IPv4 literal without DNS", async () => {
    const url = await assertPublicUrl("https://1.1.1.1/", { skipDns: true });
    expect(url.hostname).toBe("1.1.1.1");
  });

  it("accepts https URLs", async () => {
    // Use skipDns to avoid network in unit tests.
    const url = await assertPublicUrl("https://example.com/path?q=1", { skipDns: true });
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("example.com");
  });
});
