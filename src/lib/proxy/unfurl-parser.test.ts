import { describe, it, expect } from "vitest";
import { parseOpenGraph } from "./unfurl-parser";

const BASE = new URL("https://example.com/post/42");

describe("parseOpenGraph", () => {
  it("prefers og:* tags over fallbacks", () => {
    const html = `<html><head>
      <title>Fallback title</title>
      <meta property="og:title" content="OG title">
      <meta property="og:description" content="OG description">
      <meta property="og:image" content="/hero.png">
      <meta property="og:site_name" content="Example Inc.">
      <link rel="icon" href="/favicon.ico">
    </head><body>…</body></html>`;
    const data = parseOpenGraph(html, BASE);
    expect(data.title).toBe("OG title");
    expect(data.description).toBe("OG description");
    expect(data.imageUrl).toBe("https://example.com/hero.png");
    expect(data.siteName).toBe("Example Inc.");
    expect(data.favicon).toBe("https://example.com/favicon.ico");
  });

  it("falls back to twitter then description meta + <title>", () => {
    const html = `<head>
      <title>Plain title</title>
      <meta name="description" content="Meta description">
      <meta name="twitter:title" content="Twitter title">
    </head>`;
    const data = parseOpenGraph(html, BASE);
    expect(data.title).toBe("Twitter title");
    expect(data.description).toBe("Meta description");
  });

  it("falls back to <title> when no og/twitter title", () => {
    const html = `<head><title>Just the title</title></head>`;
    const data = parseOpenGraph(html, BASE);
    expect(data.title).toBe("Just the title");
  });

  it("resolves relative image URLs against the final URL", () => {
    const html = `<head><meta property="og:image" content="img/foo.jpg"></head>`;
    const data = parseOpenGraph(html, BASE);
    expect(data.imageUrl).toBe("https://example.com/post/img/foo.jpg");
  });

  it("decodes HTML entities in content", () => {
    const html = `<head>
      <meta property="og:title" content="Tom &amp; Jerry">
      <title>Fallback</title>
    </head>`;
    const data = parseOpenGraph(html, BASE);
    expect(data.title).toBe("Tom & Jerry");
  });

  it("returns null fields when nothing present, but still fills siteName + default favicon", () => {
    const html = `<html><body>no head</body></html>`;
    const data = parseOpenGraph(html, BASE);
    expect(data.title).toBe(null);
    expect(data.description).toBe(null);
    expect(data.imageUrl).toBe(null);
    // Hostname as fallback siteName.
    expect(data.siteName).toBe("example.com");
    // Default /favicon.ico when no <link rel=icon>.
    expect(data.favicon).toBe("https://example.com/favicon.ico");
  });

  it("truncates long descriptions to 300 chars", () => {
    const longText = "x".repeat(500);
    const html = `<head><meta property="og:description" content="${longText}"></head>`;
    const data = parseOpenGraph(html, BASE);
    expect(data.description?.length).toBeLessThanOrEqual(300);
  });

  it("prefers apple-touch-icon for favicon", () => {
    const html = `<head>
      <link rel="icon" href="/small.ico">
      <link rel="apple-touch-icon" href="/big.png">
    </head>`;
    const data = parseOpenGraph(html, BASE);
    expect(data.favicon).toBe("https://example.com/big.png");
  });
});
