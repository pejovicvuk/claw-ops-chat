import { lookup } from "dns/promises";
import { isIP } from "net";

/**
 * SSRF guard used by both /api/proxy/unfurl and /api/proxy/image.
 *
 * Rejects URLs whose hostname resolves to a private/loopback/link-local
 * range — the two proxies must only reach public internet destinations.
 * Re-run on every redirect hop (DNS can return different answers each
 * call, which is how DNS rebinding attacks work; we re-resolve fresh
 * each time).
 *
 * Also rejects non-http(s) schemes (file://, data:, javascript:, etc.).
 */

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

const BLOCKED_IPV4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local incl. AWS metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmark
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
  ["255.255.255.255", 32],
];

const BLOCKED_IPV6_PREFIXES = [
  "::", // unspecified
  "::1", // loopback
  "fe80:", // link-local
  "fc", // unique-local (fc00::/7 — prefixes fc and fd)
  "fd",
  "ff", // multicast
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p) || p < 0 || p > 255)) {
    return -1;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipv4InRange(ip: string, base: string, bits: number): boolean {
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt < 0 || baseInt < 0) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    return BLOCKED_IPV4_RANGES.some(([base, bits]) => ipv4InRange(ip, base, bits));
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    return BLOCKED_IPV6_PREFIXES.some((prefix) => lower.startsWith(prefix));
  }
  // Not a valid IP literal — treat as safe here (caller resolves via DNS).
  return false;
}

/**
 * Throws SsrfError if the URL is unsafe to fetch. Returns a parsed URL
 * object on success. Callers must re-run this on every redirect hop.
 */
export async function assertPublicUrl(
  rawUrl: string,
  opts: { skipDns?: boolean } = {},
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfError("Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfError(`Blocked scheme: ${parsed.protocol}`);
  }

  // If hostname is already an IP literal, just check it.
  const hostname = parsed.hostname;
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new SsrfError(`Blocked private address: ${hostname}`);
    }
    return parsed;
  }

  // Reject obviously local hostnames fast.
  const lowerHost = hostname.toLowerCase();
  if (
    lowerHost === "localhost" ||
    lowerHost.endsWith(".local") ||
    lowerHost.endsWith(".internal")
  ) {
    throw new SsrfError(`Blocked hostname: ${hostname}`);
  }

  if (opts.skipDns) return parsed;

  // Resolve — if ANY resolved address is private, reject. Protects against
  // hosts that publish mixed public + private addresses.
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new SsrfError(`DNS lookup failed: ${hostname}`);
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new SsrfError(`Blocked private address for ${hostname}: ${address}`);
    }
  }
  return parsed;
}

/** Exposed for unit tests. */
export const __INTERNAL = { isPrivateIp, ipv4InRange };
