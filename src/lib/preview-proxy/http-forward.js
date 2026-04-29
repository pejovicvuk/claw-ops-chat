"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PREVIEW_PREFIX = void 0;
exports.matchPreviewPath = matchPreviewPath;
exports.forwardHttp = forwardHttp;
const http_1 = __importDefault(require("http"));
const auth_server_1 = require("../auth-server");
const html_rewriter_1 = require("./html-rewriter");
/**
 * Streaming HTTP reverse proxy for `/chat/preview/<port>/<rest>`.
 *
 * Forwards HTTP traffic to `http://127.0.0.1:<port><rest>` so the user
 * can iframe a localhost dev server inside the chat app under a
 * same-origin URL. WebSocket upgrades for the same path go through
 * `ws-forward.ts`. Auth gate matches the rest of the codebase: signed
 * session cookie (no ws-ticket fallback — this is plain HTTP).
 *
 * Headers we strip / rewrite:
 *   - Drop our own `claw-session` cookie before forwarding
 *   - Drop hop-by-hop headers per RFC 7230
 *   - Strip upstream framing-blockers so the iframe loads
 *   - Rewrite root-anchored `Location` on 3xx
 *   - Strip `Domain` from upstream `Set-Cookie` so Set-Cookie lands on
 *     the chat origin instead of being rejected for `Domain=localhost`
 *
 * HTML responses are streamed through `createHtmlRewriter` to splice a
 * `<base href>` + URL-rewriting shim into `<head>`. Non-HTML passes
 * through unchanged.
 */
exports.PREVIEW_PREFIX = "/chat/preview";
const PORT_MIN = 1024;
const PORT_MAX = 65535;
const HOP_BY_HOP = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
]);
/**
 * Match a request URL like `/chat/preview/5173/foo/bar?x=1` to its
 * preview-proxy components. Returns null if the URL isn't a preview
 * path. Returns `{ port: NaN }` if the port segment isn't a valid
 * integer in range — caller can 400 on that case.
 */
function matchPreviewPath(rawUrl) {
    // Strip query for path matching.
    const qIdx = rawUrl.indexOf("?");
    const path = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx);
    if (!path.startsWith(`${exports.PREVIEW_PREFIX}/`))
        return null;
    const rest = path.slice(exports.PREVIEW_PREFIX.length + 1); // after "/chat/preview/"
    const slashIdx = rest.indexOf("/");
    const portStr = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
    const portNum = Number.parseInt(portStr, 10);
    // Always include rest. If the URL is `/chat/preview/5173` without a
    // trailing slash, redirect to `/chat/preview/5173/` at the caller.
    const upstreamPath = slashIdx === -1 ? "/" : "/" + rest.slice(slashIdx + 1);
    return {
        port: portNum,
        upstreamPath,
        prefix: `${exports.PREVIEW_PREFIX}/${portStr}/`,
    };
}
/**
 * Drive one HTTP request through the proxy. Caller has already matched
 * the URL via `matchPreviewPath`; this handles auth, validation, and
 * the upstream round-trip. Always closes `res` exactly once.
 */
function forwardHttp(req, res, match, opts) {
    // Auth gate. Single-user model — signed session cookie is required.
    const session = (0, auth_server_1.extractSessionFromCookieHeader)(req.headers.cookie);
    if (!session) {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
    }
    // Port validation.
    if (!Number.isInteger(match.port) ||
        match.port < PORT_MIN ||
        match.port > PORT_MAX ||
        match.port === opts.selfPort) {
        writeJson(res, 400, {
            error: `Invalid preview port: ${match.port}. Must be in [${PORT_MIN}, ${PORT_MAX}] and not the chat server's own port.`,
        });
        return;
    }
    // Build the upstream request. Preserve method, body, and query
    // string. The path is `match.upstreamPath` plus the original query.
    const queryIdx = req.url?.indexOf("?") ?? -1;
    const queryStr = queryIdx === -1 ? "" : (req.url ?? "").slice(queryIdx);
    const upstreamUrl = `${match.upstreamPath}${queryStr}`;
    const upstream = http_1.default.request({
        host: "127.0.0.1",
        port: match.port,
        method: req.method,
        path: upstreamUrl,
        headers: filterRequestHeaders(req.headers, match),
    }, (upRes) => {
        const status = upRes.statusCode ?? 502;
        const headers = filterResponseHeaders(upRes.headers, match, req);
        // Treat HTML as a stream we rewrite; everything else passes through.
        if (isHtmlContentType(upRes.headers["content-type"])) {
            // Drop content-length — the rewriter changes the byte count.
            delete headers["content-length"];
            res.writeHead(status, headers);
            const rewriter = (0, html_rewriter_1.createHtmlRewriter)({ prefix: match.prefix, port: match.port });
            upRes.on("error", (err) => {
                // Upstream error mid-stream — close the response. Headers
                // already sent so we can't send a JSON body; rely on the
                // socket close to surface to the client.
                rewriter.destroy(err);
                res.end();
            });
            rewriter.on("error", () => {
                res.end();
            });
            upRes.pipe(rewriter).pipe(res);
            return;
        }
        res.writeHead(status, headers);
        upRes.on("error", () => res.end());
        upRes.pipe(res);
    });
    upstream.on("error", (err) => {
        if (res.headersSent) {
            res.end();
            return;
        }
        if (err.code === "ECONNREFUSED" || err.code === "ECONNRESET") {
            writeJson(res, 502, {
                error: "Dev server not reachable",
                port: match.port,
                detail: err.message,
            });
            return;
        }
        writeJson(res, 502, { error: "Upstream error", detail: err.message });
    });
    // Pipe the request body through. For methods without a body (GET/HEAD)
    // this is still safe — `pipe` will just close the upstream's stdin
    // when `req` ends, which fires immediately.
    req.on("error", () => upstream.destroy());
    req.pipe(upstream);
}
function filterRequestHeaders(headers, match) {
    const out = {};
    for (const [k, v] of Object.entries(headers)) {
        if (v === undefined)
            continue;
        const lower = k.toLowerCase();
        if (HOP_BY_HOP.has(lower))
            continue;
        if (lower === "host")
            continue;
        if (lower === "cookie") {
            // Strip our own session cookie before forwarding so the dev
            // app doesn't see it. Keep any other cookies the dev app might
            // have set on the chat origin (rare but possible).
            const filtered = stripClawSession(typeof v === "string" ? v : v.join("; "));
            if (filtered)
                out["cookie"] = filtered;
            continue;
        }
        out[lower] = v;
    }
    // Identify ourselves to the dev app so `req.headers["x-forwarded-prefix"]`
    // can be read by frameworks that care.
    out["host"] = `127.0.0.1:${match.port}`;
    out["x-forwarded-host"] = String(headers["host"] ?? "");
    out["x-forwarded-proto"] = String(headers["x-forwarded-proto"] ?? "http");
    out["x-forwarded-prefix"] = match.prefix.replace(/\/$/, "");
    return out;
}
function filterResponseHeaders(headers, match, req) {
    const out = {};
    for (const [k, v] of Object.entries(headers)) {
        if (v === undefined)
            continue;
        const lower = k.toLowerCase();
        if (HOP_BY_HOP.has(lower))
            continue;
        // Strip framing-blockers from upstream — the chat sets its own
        // (relaxed) headers for /preview/* via next.config.ts.
        if (lower === "x-frame-options" || lower === "content-security-policy")
            continue;
        // Strip Domain= from Set-Cookie so the cookie lands on the chat
        // origin rather than being rejected for Domain=localhost.
        if (lower === "set-cookie") {
            const cookies = Array.isArray(v) ? v : [v];
            out["set-cookie"] = cookies.map(stripCookieDomain);
            continue;
        }
        // Rewrite Location for 3xx so root-anchored redirects stay inside
        // the proxy prefix instead of escaping to the chat app.
        if (lower === "location" && typeof v === "string") {
            out["location"] = rewriteLocation(v, match);
            continue;
        }
        out[lower] = v;
    }
    // Force same-origin embedding regardless of upstream defaults; the
    // chat-side override in next.config.ts also sets this for
    // belt-and-suspenders.
    out["x-frame-options"] = "SAMEORIGIN";
    // Mark the response as ours for debugging.
    out["x-claw-preview-port"] = String(match.port);
    // Don't cache anything — dev server output changes constantly and
    // a cached HTML with the wrong base href would be a debugging
    // nightmare.
    out["cache-control"] = "no-store";
    // Quiet a TS unused-arg warning in the rare future where we want
    // request-correlated logging.
    void req;
    return out;
}
function stripClawSession(cookie) {
    const parts = cookie
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith("claw-session="));
    return parts.join("; ");
}
function stripCookieDomain(cookie) {
    return cookie
        .split(";")
        .filter((p) => !/^\s*domain\s*=/i.test(p))
        .join(";");
}
function rewriteLocation(location, match) {
    // Same-origin absolute (http://localhost:<port>/foo) → proxy prefix
    for (const host of [`http://127.0.0.1:${match.port}`, `http://localhost:${match.port}`]) {
        if (location.startsWith(host)) {
            const rest = location.slice(host.length);
            return match.prefix.replace(/\/$/, "") + (rest.startsWith("/") ? rest : "/" + rest);
        }
    }
    // Root-anchored relative (/foo) → proxy prefix
    if (location.startsWith("/") && !location.startsWith("//")) {
        return match.prefix.replace(/\/$/, "") + location;
    }
    // Already-prefixed or external — leave as-is.
    return location;
}
function isHtmlContentType(ct) {
    if (!ct)
        return false;
    const value = Array.isArray(ct) ? ct[0] : ct;
    return /^\s*text\/html\b/i.test(value);
}
function writeJson(res, status, body) {
    if (res.headersSent) {
        res.end();
        return;
    }
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(payload).toString(),
        "cache-control": "no-store",
    });
    res.end(payload);
}
