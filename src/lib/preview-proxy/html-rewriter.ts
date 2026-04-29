import { Transform, type TransformCallback } from "stream";

/**
 * Streaming HTML rewriter for the preview proxy.
 *
 * Path-prefix proxying breaks dev-server HMR clients that hard-code
 * absolute URLs at build time (Vite ships `<script src="/@vite/client">`,
 * Webpack-dev-server connects `new WebSocket("ws://host:port/ws")`, etc.).
 * On the first HTML response of a preview tab we splice into `<head>`:
 *
 *   1. `<base href="/chat/preview/<port>/">` so all relative URLs in the
 *      HTML resolve under the proxy prefix.
 *   2. A tiny inline shim that wraps `WebSocket`, `EventSource`, `fetch`,
 *      `XMLHttpRequest.prototype.open` and rewrites root-anchored or
 *      `localhost:<port>` URLs to the proxy URL — covers the absolute
 *      strings the bundler baked in.
 *
 * If the upstream HTML already contains its own `<base ` before the
 * closing `</head>`, we skip the `<base>` injection (the user's app is
 * already configured for a path prefix — typically the documented
 * `base: '/chat/preview/<port>/'` Vite config). We still inject the
 * shim because the WebSocket monkey-patch is harmless when not needed.
 *
 * Implementation notes:
 *   - Stateful streaming transform; never buffers the full response
 *   - Carries a tail of `MAX_TAG_LEN` bytes across chunks so a `<head>`
 *     tag split across two reads is still detected
 *   - Pure pass-through after injection; flushes the carry on end
 */

const HEAD_OPEN_RE = /<head\b[^>]*>/i;
const BASE_TAG_RE = /<base\b/i;
const HEAD_CLOSE_RE = /<\/head\s*>/i;
const MAX_TAG_LEN = 256;

export interface HtmlRewriterOptions {
  /** Absolute path prefix to splice into `<base href>` and the URL shim. Must end with `/`. */
  prefix: string;
  /** Upstream port — used by the shim to recognise absolute URLs back to the dev server. */
  port: number;
}

export function createHtmlRewriter({ prefix, port }: HtmlRewriterOptions): Transform {
  if (!prefix.endsWith("/")) {
    throw new Error(`HtmlRewriter prefix must end with '/'; got ${JSON.stringify(prefix)}`);
  }

  type Phase = "scanning" | "scanning-base" | "passthrough";
  let phase: Phase = "scanning";
  let carry = "";

  const inject = buildInjection(prefix, port);

  return new Transform({
    transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
      try {
        // Combine carry + new chunk as a single string. We assume UTF-8;
        // dev servers serve UTF-8 HTML universally and our injection is
        // ASCII so we don't risk splitting a multi-byte char in the
        // injected region.
        let buf = carry + chunk.toString("utf-8");
        carry = "";

        if (phase === "passthrough") {
          this.push(buf);
          return cb();
        }

        if (phase === "scanning") {
          const match = HEAD_OPEN_RE.exec(buf);
          if (!match) {
            // No `<head>` yet. Keep a tail so the tag isn't split across
            // chunks; flush the rest unchanged.
            const safe = Math.max(0, buf.length - MAX_TAG_LEN);
            if (safe > 0) this.push(buf.slice(0, safe));
            carry = buf.slice(safe);
            return cb();
          }
          // Splice the `<base>` decision: scan forward to `</head>` to
          // see if the upstream already declared one. We may need to
          // look across more than one chunk for that decision, but in
          // practice `<base>` (when present) is at the very top of the
          // head — keep going if we already see `</head>`, otherwise
          // assume the upstream did NOT set a base.
          const tagEnd = match.index + match[0].length;
          const head = buf.slice(0, tagEnd);
          const tail = buf.slice(tagEnd);
          this.push(head);
          phase = "scanning-base";
          buf = tail;
          // Fall through into the scanning-base branch with the tail.
        }

        if (phase === "scanning-base") {
          const closeIdx = buf.search(HEAD_CLOSE_RE);
          if (closeIdx === -1) {
            // Haven't seen `</head>` yet — check whether `<base>` already
            // appears in what we have so far. If yes, switch to
            // passthrough WITHOUT injecting `<base>` (only the shim).
            // If no, we're still uncertain; keep accumulating in carry.
            if (BASE_TAG_RE.test(buf)) {
              this.push(inject.shimOnly);
              this.push(buf);
              phase = "passthrough";
              return cb();
            }
            // Hold this chunk so we can decide after we see `</head>`.
            // Bound the carry to avoid pathological pages — if we've
            // already read >64 KB of head without finding `</head>` we
            // give up and emit the full injection (nothing weirder
            // happens on a non-conforming page).
            if (carry.length + buf.length > 64 * 1024) {
              this.push(inject.full);
              this.push(buf);
              phase = "passthrough";
              return cb();
            }
            carry += buf;
            return cb();
          }

          // We saw `</head>`. Was there a `<base>` between `<head>` and
          // here? carry holds the prior accumulated head content; buf
          // holds the current chunk up to closeIdx.
          const headInner = carry + buf.slice(0, closeIdx);
          carry = "";
          const tail = buf.slice(closeIdx);
          if (BASE_TAG_RE.test(headInner)) {
            this.push(headInner);
            this.push(inject.shimOnly);
          } else {
            this.push(inject.full);
            this.push(headInner);
          }
          this.push(tail);
          phase = "passthrough";
          return cb();
        }

        return cb();
      } catch (err) {
        return cb(err as Error);
      }
    },
    flush(cb) {
      if (carry.length > 0) {
        // We never finished the head decision before the response ended.
        // Inject the full payload and emit whatever we held.
        if (phase === "scanning-base") this.push(inject.full);
        this.push(carry);
        carry = "";
      }
      cb();
    },
  });
}

function buildInjection(prefix: string, port: number) {
  const baseTag = `<base href="${escapeHtmlAttr(prefix)}">`;
  // Escaping note: the shim is inlined verbatim; keep it ASCII and
  // free of `</script` substrings. The only interpolated value is the
  // prefix and the port, both validated at the route boundary.
  const shim = `<script>(function(){try{
var P=${JSON.stringify(prefix)};
var L="http://127.0.0.1:${port}";var L1="http://localhost:${port}";
function rw(u){if(typeof u!=="string")return u;
  if(u.indexOf(L)===0)return P.replace(/\\/$/,"")+u.slice(L.length);
  if(u.indexOf(L1)===0)return P.replace(/\\/$/,"")+u.slice(L1.length);
  if(u.indexOf("ws://127.0.0.1:${port}")===0)return rwWs(u,"ws://127.0.0.1:${port}");
  if(u.indexOf("ws://localhost:${port}")===0)return rwWs(u,"ws://localhost:${port}");
  if(u.indexOf("wss://127.0.0.1:${port}")===0)return rwWs(u,"wss://127.0.0.1:${port}");
  if(u.indexOf("wss://localhost:${port}")===0)return rwWs(u,"wss://localhost:${port}");
  if(u.charAt(0)==="/"&&u.charAt(1)!=="/"&&u.indexOf(P)!==0)return P.replace(/\\/$/,"")+u;
  return u;}
function rwWs(u,p){var proto=location.protocol==="https:"?"wss:":"ws:";
  return proto+"//"+location.host+P.replace(/\\/$/,"")+u.slice(p.length);}
var OW=window.WebSocket;window.WebSocket=function(u,pr){return new OW(rw(u),pr);};
window.WebSocket.prototype=OW.prototype;window.WebSocket.CONNECTING=OW.CONNECTING;
window.WebSocket.OPEN=OW.OPEN;window.WebSocket.CLOSING=OW.CLOSING;window.WebSocket.CLOSED=OW.CLOSED;
if(window.EventSource){var OE=window.EventSource;window.EventSource=function(u,o){return new OE(rw(u),o);};window.EventSource.prototype=OE.prototype;}
var OF=window.fetch;if(OF){window.fetch=function(i,o){if(typeof i==="string")i=rw(i);return OF.call(window,i,o);};}
var OO=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=rw(u);return OO.apply(this,arguments);};
}catch(e){}})();<\/script>`;
  return {
    full: `${baseTag}${shim}`,
    shimOnly: shim,
  };
}

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
