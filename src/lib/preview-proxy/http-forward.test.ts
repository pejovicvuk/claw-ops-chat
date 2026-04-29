import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http, { type IncomingMessage, type ServerResponse } from "http";
import { gzipSync } from "zlib";
import { AddressInfo } from "net";
import { signSession } from "../auth-server";
import { forwardHttp, matchPreviewPath } from "./http-forward";

/**
 * Integration test for the preview HTTP proxy.
 *
 * We stand up two real `http.Server`s:
 *   - upstream: simulates a dev server (Vite/Next/etc.) on a random port
 *   - chat: invokes `forwardHttp` for any inbound request, mirroring how
 *     `server.ts` mounts it
 *
 * Then we curl through the chat server and assert on the response body
 * + headers. Drives the gzip-corruption regression directly.
 */

/**
 * Mint a cookie via the auth-server module's own `signSession` so we
 * use whatever SESSION_SECRET the module captured at load time. Trying
 * to override SESSION_SECRET in `beforeAll` would be too late — the
 * env capture is done at module import.
 */
function mintCookie(): string {
  return `claw-session=${signSession("test@example.com")}`;
}

interface Servers {
  upstream: http.Server;
  upstreamPort: number;
  chat: http.Server;
  chatPort: number;
}

let servers: Servers | null = null;
let upstreamHandler: (req: IncomingMessage, res: ServerResponse) => void;

async function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

beforeAll(async () => {
  const upstream = http.createServer((req, res) => upstreamHandler(req, res));
  const upstreamPort = await listen(upstream);

  const chat = http.createServer((req, res) => {
    const match = matchPreviewPath(req.url ?? "");
    if (!match) {
      res.writeHead(404).end();
      return;
    }
    forwardHttp(req, res, match, { selfPort: 0 });
  });
  const chatPort = await listen(chat);

  servers = { upstream, upstreamPort, chat, chatPort };
});

afterAll(async () => {
  if (!servers) return;
  await Promise.all([
    new Promise<void>((r) => servers!.upstream.close(() => r())),
    new Promise<void>((r) => servers!.chat.close(() => r())),
  ]);
  servers = null;
});

interface CapturedResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

async function fetchThroughChat(
  path: string,
  headers: Record<string, string> = {},
): Promise<CapturedResponse> {
  if (!servers) throw new Error("servers not initialized");
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: servers!.chatPort,
        path,
        method: "GET",
        headers: { Cookie: mintCookie(), ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.from(c)));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("forwardHttp", () => {
  it("rewrites identity-encoded HTML with <base href> + URL shim", async () => {
    upstreamHandler = (_req, res) => {
      const body =
        "<!doctype html><html><head><title>X</title></head><body>hi from upstream</body></html>";
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
    };

    const out = await fetchThroughChat(`/chat/preview/${servers!.upstreamPort}/`);

    expect(out.status).toBe(200);
    expect(out.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(out.headers["x-claw-preview-port"]).toBe(String(servers!.upstreamPort));
    expect(out.headers["cache-control"]).toBe("no-store");

    const text = out.body.toString("utf-8");
    expect(text).toContain(`<base href="/chat/preview/${servers!.upstreamPort}/">`);
    expect(text).toContain("window.WebSocket=function");
    expect(text).toContain("hi from upstream");
  });

  it("passes through gzipped HTML unchanged when the upstream ignores Accept-Encoding: identity", async () => {
    // Force upstream to return Content-Encoding: gzip even though our
    // proxy asks for `Accept-Encoding: identity`. Simulates frameworks
    // that always compress regardless of the request's Accept-Encoding.
    upstreamHandler = (_req, res) => {
      const body =
        "<!doctype html><html><head><title>X</title></head><body>hi gzipped</body></html>";
      const gz = gzipSync(body);
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-encoding": "gzip",
        "content-length": String(gz.length),
      });
      res.end(gz);
    };

    const out = await fetchThroughChat(`/chat/preview/${servers!.upstreamPort}/`);

    expect(out.status).toBe(200);
    // Encoding preserved — the front-proxy / browser will decode normally.
    expect(out.headers["content-encoding"]).toBe("gzip");
    // Body is byte-identical to the upstream's gzip — no rewriter
    // corruption (which would replace the 0x8b magic byte with the
    // U+FFFD UTF-8 sequence 0xef 0xbf 0xbd).
    expect(out.body.length).toBe(
      gzipSync("<!doctype html><html><head><title>X</title></head><body>hi gzipped</body></html>")
        .length,
    );
    expect(out.body[0]).toBe(0x1f);
    expect(out.body[1]).toBe(0x8b); // gzip magic intact
    expect(out.body[2]).toBe(0x08);
  });

  it("strips request Accept-Encoding so upstream returns plain text by default", async () => {
    let observedAcceptEncoding: string | undefined;
    upstreamHandler = (req, res) => {
      observedAcceptEncoding = req.headers["accept-encoding"] as string | undefined;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><html><head></head><body>ok</body></html>");
    };

    await fetchThroughChat(`/chat/preview/${servers!.upstreamPort}/`, {
      "Accept-Encoding": "gzip, deflate, br, zstd",
    });

    expect(observedAcceptEncoding).toBe("identity");
  });

  it("returns 401 when no session cookie is present", async () => {
    upstreamHandler = (_req, res) => {
      res.writeHead(200).end();
    };

    const res = await new Promise<CapturedResponse>((resolve, reject) => {
      const r = http.request(
        {
          host: "127.0.0.1",
          port: servers!.chatPort,
          path: `/chat/preview/${servers!.upstreamPort}/`,
          method: "GET",
        },
        (rr) => {
          const chunks: Buffer[] = [];
          rr.on("data", (c) => chunks.push(Buffer.from(c)));
          rr.on("end", () =>
            resolve({
              status: rr.statusCode ?? 0,
              headers: rr.headers,
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      r.on("error", reject);
      r.end();
    });

    expect(res.status).toBe(401);
  });

  it("returns 502 with structured JSON when upstream is unreachable", async () => {
    // Pick a port that's almost certainly closed.
    const out = await fetchThroughChat(`/chat/preview/65530/`);
    expect(out.status).toBe(502);
    const json = JSON.parse(out.body.toString("utf-8"));
    expect(json.error).toBe("Dev server not reachable");
    expect(json.port).toBe(65530);
  });
});
