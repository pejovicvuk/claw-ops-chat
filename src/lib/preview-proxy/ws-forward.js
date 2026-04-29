"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.forwardWs = forwardWs;
const ws_1 = require("ws");
const auth_server_1 = require("../auth-server");
const PORT_MIN = 1024;
const PORT_MAX = 65535;
function forwardWs(req, socket, head, match, opts) {
    // Auth gate — same shape as the chat WS upgrade in server.ts.
    const session = (0, auth_server_1.extractSessionFromCookieHeader)(req.headers.cookie);
    if (!session) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
    }
    if (!Number.isInteger(match.port) ||
        match.port < PORT_MIN ||
        match.port > PORT_MAX ||
        match.port === opts.selfPort) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
    }
    // Build the upstream WS URL preserving original query string.
    const queryIdx = req.url?.indexOf("?") ?? -1;
    const queryStr = queryIdx === -1 ? "" : (req.url ?? "").slice(queryIdx);
    const upstreamUrl = `ws://127.0.0.1:${match.port}${match.upstreamPath}${queryStr}`;
    // Forward selected request headers — Subprotocol negotiation is
    // critical for HMR clients that pass things like
    // `sec-websocket-protocol: vite-hmr`. Drop hop-by-hop and our cookie.
    const upstreamHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined)
            continue;
        const lower = k.toLowerCase();
        if (lower === "host" ||
            lower === "connection" ||
            lower === "upgrade" ||
            lower === "sec-websocket-key" ||
            lower === "sec-websocket-version" ||
            lower === "sec-websocket-extensions" ||
            lower === "cookie") {
            continue;
        }
        upstreamHeaders[k] = Array.isArray(v) ? v.join(", ") : String(v);
    }
    let upstream;
    try {
        upstream = new ws_1.WebSocket(upstreamUrl, {
            headers: upstreamHeaders,
            // Forward the same subprotocols as the client requested.
            protocol: req.headers["sec-websocket-protocol"],
        });
    }
    catch {
        socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        socket.destroy();
        return;
    }
    // If the upstream errors before opening, surface 502 to the client.
    let upstreamOpened = false;
    upstream.once("open", () => {
        upstreamOpened = true;
        opts.wss.handleUpgrade(req, socket, head, (clientWs) => {
            bridge(clientWs, upstream);
        });
    });
    upstream.once("error", (err) => {
        if (upstreamOpened) {
            // Already bridged — let the bridge handle teardown.
            return;
        }
        socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        socket.write(`X-Claw-Preview-Detail: ${err.message.replace(/[\r\n]/g, " ")}\r\n\r\n`);
        socket.destroy();
    });
    // If the client tears down the TCP socket before upstream opens,
    // close the upstream too.
    socket.once("close", () => {
        if (!upstreamOpened && upstream.readyState !== ws_1.WebSocket.CLOSED) {
            upstream.terminate();
        }
    });
}
function bridge(client, upstream) {
    const closeBoth = () => {
        if (client.readyState === ws_1.WebSocket.OPEN || client.readyState === ws_1.WebSocket.CONNECTING) {
            client.close();
        }
        if (upstream.readyState === ws_1.WebSocket.OPEN || upstream.readyState === ws_1.WebSocket.CONNECTING) {
            upstream.close();
        }
    };
    // Bidirectional message forwarding. `binary` is preserved so binary
    // HMR frames (rare but possible) survive the bridge.
    client.on("message", (data, isBinary) => {
        if (upstream.readyState === ws_1.WebSocket.OPEN) {
            upstream.send(data, { binary: isBinary });
        }
    });
    upstream.on("message", (data, isBinary) => {
        if (client.readyState === ws_1.WebSocket.OPEN) {
            client.send(data, { binary: isBinary });
        }
    });
    client.on("close", closeBoth);
    upstream.on("close", closeBoth);
    client.on("error", closeBoth);
    upstream.on("error", closeBoth);
}
