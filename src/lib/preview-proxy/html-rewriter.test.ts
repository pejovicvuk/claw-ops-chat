import { describe, expect, it } from "vitest";
import { Readable } from "stream";
import { createHtmlRewriter } from "./html-rewriter";

async function run(input: string | string[]): Promise<string> {
  const chunks = Array.isArray(input) ? input : [input];
  const rewriter = createHtmlRewriter({ prefix: "/chat/preview/5173/", port: 5173 });
  const out: Buffer[] = [];
  rewriter.on("data", (c: Buffer) => out.push(Buffer.from(c)));
  await new Promise<void>((resolve, reject) => {
    rewriter.on("end", resolve);
    rewriter.on("error", reject);
    Readable.from(chunks).pipe(rewriter);
  });
  return Buffer.concat(out).toString("utf-8");
}

describe("createHtmlRewriter", () => {
  it("injects <base> + shim into a single-chunk HTML response", async () => {
    const out = await run(
      "<!doctype html><html><head><title>X</title></head><body>hi</body></html>",
    );
    expect(out).toContain('<base href="/chat/preview/5173/">');
    expect(out).toContain("window.WebSocket=function");
    expect(out).toContain("<title>X</title>");
    expect(out).toContain("<body>hi</body>");
  });

  it("handles <head> split across chunk boundaries", async () => {
    const out = await run([
      "<!doctype html><html><he",
      "ad><title>X</title></head><body>hi</body></html>",
    ]);
    expect(out).toContain('<base href="/chat/preview/5173/">');
    expect(out).toContain("<title>X</title>");
  });

  it("skips <base> injection when upstream already has its own", async () => {
    const out = await run(
      '<html><head><base href="/foo/"><title>X</title></head><body></body></html>',
    );
    expect(out).not.toContain('<base href="/chat/preview/5173/">');
    expect(out).toContain('<base href="/foo/">');
    // Shim still injected.
    expect(out).toContain("window.WebSocket=function");
  });

  it("passes plain bodies through when there is no <head>", async () => {
    const input = "this is not really html, no head tag here\n".repeat(50);
    const out = await run(input);
    expect(out).toBe(input);
  });

  it("preserves multi-byte UTF-8 chars across chunk boundaries", async () => {
    // Split a string containing multi-byte characters into two chunks
    // where the boundary lands AFTER a complete character (we don't
    // claim to handle byte-split UTF-8 — only that we don't corrupt
    // chars when the boundary is char-aligned, which is what real
    // streams give us).
    const html = "<html><head>--✨--</head><body>héllo</body></html>";
    const out = await run([html.slice(0, 20), html.slice(20)]);
    expect(out).toContain("✨");
    expect(out).toContain("héllo");
    expect(out).toContain('<base href="/chat/preview/5173/">');
  });

  it("emits the injection even on a head that streams without </head> until late", async () => {
    // Some dev servers stream tons of <head> content before closing it.
    // We should still inject before the first child that needs it.
    const headContent = "<meta>".repeat(2000);
    const out = await run(`<html><head>${headContent}</head><body></body></html>`);
    expect(out).toContain('<base href="/chat/preview/5173/">');
    expect(out.indexOf("<base")).toBeLessThan(out.indexOf("</head>"));
  });

  it("falls back to full injection if the head exceeds the safety bound without </head>", async () => {
    // Pathological input — no </head> within 64 KB. We should still
    // inject so the user's HMR client at least has a chance to work.
    const giant = "<meta>".repeat(20000);
    const out = await run(`<html><head>${giant}<body></body></html>`);
    expect(out).toContain('<base href="/chat/preview/5173/">');
  });
});
