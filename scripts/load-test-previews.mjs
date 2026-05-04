#!/usr/bin/env node
// Phase 6b (#135) preview-stream load-test harness.
//
// Spawns a tiny "busy page" HTTP server, mints a session cookie inline
// using the same HMAC scheme as src/lib/auth-server.ts, and ramps from
// concurrency=1 up to N preview-stream WebSocket connections against a
// running chat server (default http://localhost:3100/chat). At each
// concurrency level it holds for `--hold` seconds while sampling
// /api/monitoring/previews, then prints a per-N table of:
//   N | TTFF p50 (ms) | FPS p50 | KB/s p50 | Chromium CPU% |
//   Chromium RSS (MB) | Restarts | Input p50 (ms)
//
// Usage:
//   node scripts/load-test-previews.mjs --concurrency=4 --hold=15
//
// Env (read from .env.local via dotenv):
//   SESSION_SECRET — required, must match the running server's secret
//   ALLOWED_EMAIL  — used as actor; must match the server's allowed email
//
// Standalone — only depends on the already-installed `ws` package.

// Load .env.local first (Next.js convention used by the chat server), then
// .env as a fallback. Both are no-ops in production where the env is
// supplied directly by docker-compose.
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", quiet: true });
dotenvConfig({ quiet: true });

import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

/* -------------------------------------------------------------------- */
/* CLI                                                                  */
/* -------------------------------------------------------------------- */

const { values } = parseArgs({
  options: {
    target: { type: "string", default: "http://localhost:3100/chat" },
    concurrency: { type: "string", default: "4" },
    hold: { type: "string", default: "15" },
    codec: { type: "string", default: "jpeg" },
    "upstream-port": { type: "string", default: "9100" },
    email: { type: "string" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`Usage: node scripts/load-test-previews.mjs [options]

Options:
  --target=<url>          Chat-server origin including basePath (default: http://localhost:3100/chat)
  --concurrency=<n>       Final concurrency to ramp to (default: 4)
  --hold=<seconds>        Steady-state sampling window per N (default: 15)
  --codec=<jpeg|h264>     Wire codec to request (default: jpeg)
  --upstream-port=<n>     Port for the spawned "busy page" upstream (default: 9100)
  --email=<addr>          Override session actor email (default: $ALLOWED_EMAIL)
  --json                  Emit results as JSON (default: text table)
  --help                  Print this and exit

Env:
  SESSION_SECRET          Required, must match the running server.
  ALLOWED_EMAIL           Used as actor unless --email is passed.
`);
  process.exit(0);
}

const TARGET = values.target.replace(/\/$/, "");
const CONCURRENCY = Number.parseInt(values.concurrency, 10);
const HOLD_SECONDS = Number.parseInt(values.hold, 10);
const CODEC = values.codec === "h264" ? "h264" : "jpeg";
const UPSTREAM_PORT = Number.parseInt(values["upstream-port"], 10);
const EMIT_JSON = Boolean(values.json);
const ACTOR_EMAIL = values.email ?? process.env.ALLOWED_EMAIL;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET) {
  console.error("error: SESSION_SECRET is not set. Add it to .env.local or your shell.");
  process.exit(1);
}
if (!ACTOR_EMAIL) {
  console.error("error: ALLOWED_EMAIL not set and --email not provided.");
  process.exit(1);
}
if (
  !Number.isInteger(CONCURRENCY) ||
  CONCURRENCY < 1 ||
  CONCURRENCY > 64 ||
  !Number.isInteger(HOLD_SECONDS) ||
  HOLD_SECONDS < 1 ||
  !Number.isInteger(UPSTREAM_PORT) ||
  UPSTREAM_PORT < 1024
) {
  console.error("error: invalid numeric flag(s) — see --help.");
  process.exit(1);
}

/* -------------------------------------------------------------------- */
/* Cookie minting                                                       */
/* -------------------------------------------------------------------- */

// Mirrors signSession in src/lib/auth-server.ts so the script stays
// runnable without compiling the TypeScript source. If that algorithm
// changes, this must change too.
function mintSessionCookie(email, secret) {
  const payload = { email, exp: Math.floor(Date.now() / 1000) + 3600 };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(data).digest("hex");
  return `claw-session=${encodeURIComponent(`${data}.${sig}`)}`;
}

const COOKIE = mintSessionCookie(ACTOR_EMAIL, SESSION_SECRET);

/* -------------------------------------------------------------------- */
/* Tiny "busy page" upstream — gives the screencast something to render */
/* -------------------------------------------------------------------- */

const BUSY_PAGE_HTML = `<!doctype html><html><head><title>load-test</title>
<style>body{margin:0;background:#111;color:#eee;font-family:system-ui;overflow:hidden}
#box{position:absolute;width:60px;height:60px;background:#3af;border-radius:8px}</style>
</head><body>
<div id="box"></div>
<script>
  const box = document.getElementById("box");
  let t = 0;
  function tick() {
    t += 0.05;
    box.style.left = (50 + 200 * Math.sin(t)) + "px";
    box.style.top  = (50 + 100 * Math.cos(t * 1.3)) + "px";
    box.style.background = "hsl(" + ((t * 60) % 360) + ",80%,55%)";
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
</script>
</body></html>`;

function startUpstream() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(BUSY_PAGE_HTML);
    });
    server.once("error", reject);
    server.listen(UPSTREAM_PORT, "127.0.0.1", () => resolve(server));
  });
}

/* -------------------------------------------------------------------- */
/* Stream session                                                       */
/* -------------------------------------------------------------------- */

class StreamSession {
  constructor(index) {
    this.index = index;
    this.openedAt = Date.now();
    this.firstFrameAt = null;
    this.frames = 0;
    this.bytes = 0;
    this.lastErrorCode = null;
    this.closed = false;
    this.ws = null;
    /** Used by the input-latency probe — when set, the next frame fills in. */
    this._latencyProbeStartedAt = null;
    /** Resolves on the first binary frame after the probe started. */
    this._latencyProbeResolve = null;
  }

  open() {
    return new Promise((resolve, reject) => {
      const wsUrl =
        `${TARGET.replace(/^http/, "ws")}/ws/preview-stream/loadtest/run-${this.index}/${UPSTREAM_PORT}` +
        `?codec=${CODEC}`;
      const ws = new WebSocket(wsUrl, {
        headers: { Cookie: COOKIE },
        perMessageDeflate: false,
      });
      this.ws = ws;
      let opened = false;
      ws.on("open", () => {
        opened = true;
        resolve();
      });
      ws.on("error", (err) => {
        if (!opened) reject(err);
      });
      ws.on("close", () => {
        this.closed = true;
      });
      ws.on("message", (data, isBinary) => {
        if (isBinary) {
          this.frames += 1;
          this.bytes += data.length;
          if (this.firstFrameAt === null) this.firstFrameAt = Date.now();
          if (this._latencyProbeResolve) {
            const r = this._latencyProbeResolve;
            this._latencyProbeResolve = null;
            r(Date.now() - this._latencyProbeStartedAt);
          }
          return;
        }
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "error") this.lastErrorCode = msg.code ?? "unknown";
        } catch {
          /* non-JSON text frames are not part of the protocol */
        }
      });
    });
  }

  /**
   * Send a synthetic mouse event and resolve with the round-trip ms to
   * the next binary frame. Times out at 1 s with `null` on no-response.
   */
  async probeLatency() {
    if (this.closed || this.ws?.readyState !== WebSocket.OPEN) return null;
    return await new Promise((resolve) => {
      const t = setTimeout(() => {
        this._latencyProbeResolve = null;
        resolve(null);
      }, 1000);
      this._latencyProbeStartedAt = Date.now();
      this._latencyProbeResolve = (ms) => {
        clearTimeout(t);
        resolve(ms);
      };
      try {
        this.ws.send(
          JSON.stringify({
            type: "mouse",
            event: "mousemove",
            x: 100 + Math.floor(Math.random() * 100),
            y: 100 + Math.floor(Math.random() * 100),
          }),
        );
      } catch {
        clearTimeout(t);
        this._latencyProbeResolve = null;
        resolve(null);
      }
    });
  }

  close() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.close(1000, "loadtest-done");
      } catch {
        /* socket already closing */
      }
    }
  }

  ttffMs() {
    return this.firstFrameAt === null ? null : this.firstFrameAt - this.openedAt;
  }
}

/* -------------------------------------------------------------------- */
/* Monitoring snapshot poll                                             */
/* -------------------------------------------------------------------- */

async function fetchMonitoringSnapshot() {
  const res = await fetch(`${TARGET}/api/monitoring/previews`, {
    headers: { Cookie: COOKIE },
  });
  if (!res.ok) {
    throw new Error(`monitoring snapshot ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

/* -------------------------------------------------------------------- */
/* Stats helpers                                                        */
/* -------------------------------------------------------------------- */

function median(values) {
  const arr = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (arr.length === 0) return null;
  arr.sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid];
}

function fmt(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

/* -------------------------------------------------------------------- */
/* Per-concurrency run                                                  */
/* -------------------------------------------------------------------- */

async function runStep(level, sessions, holdSec) {
  // Reset frame/byte counters at the start of the steady-state window
  // so the FPS we compute reflects this hold, not the warm-up.
  const startCounts = sessions.map((s) => ({ frames: s.frames, bytes: s.bytes }));
  const startedAt = Date.now();
  const cpuSamples = [];
  const memSamples = [];
  let lastSnapshot = null;
  const sampleEveryMs = 2000;

  while (Date.now() - startedAt < holdSec * 1000) {
    try {
      lastSnapshot = await fetchMonitoringSnapshot();
      if (typeof lastSnapshot.chromium?.cpuPct === "number") {
        cpuSamples.push(lastSnapshot.chromium.cpuPct);
      }
      if (typeof lastSnapshot.chromium?.memBytes === "number") {
        memSamples.push(lastSnapshot.chromium.memBytes);
      }
    } catch (err) {
      // Snapshot fetch failures during a load test are interesting but
      // not fatal — log and keep going.
      console.error(`[N=${level}] monitoring snapshot failed: ${err.message}`);
    }
    await delay(sampleEveryMs);
  }

  const elapsedSec = (Date.now() - startedAt) / 1000;
  const fpsValues = sessions.map(
    (s, i) => (s.frames - startCounts[i].frames) / Math.max(elapsedSec, 0.001),
  );
  const kbpsValues = sessions.map(
    (s, i) => (s.bytes - startCounts[i].bytes) / 1024 / Math.max(elapsedSec, 0.001),
  );
  const ttffValues = sessions.map((s) => s.ttffMs());

  // Input-latency probe — fire one per session and gather.
  const inputValues = await Promise.all(sessions.map((s) => s.probeLatency()));

  const restarts = lastSnapshot?.totalRestartCount ?? 0;

  return {
    n: level,
    ttffP50: median(ttffValues),
    fpsP50: median(fpsValues),
    kbpsP50: median(kbpsValues),
    chromiumCpu: median(cpuSamples),
    chromiumMemMb: median(memSamples) === null ? null : median(memSamples) / 1024 / 1024,
    restarts,
    inputP50: median(inputValues),
    failedOpens: sessions.filter((s) => s.firstFrameAt === null).length,
    errors: sessions.filter((s) => s.lastErrorCode !== null).map((s) => s.lastErrorCode),
  };
}

/* -------------------------------------------------------------------- */
/* Main                                                                 */
/* -------------------------------------------------------------------- */

async function main() {
  console.error(
    `[loadtest] target=${TARGET} concurrency=${CONCURRENCY} hold=${HOLD_SECONDS}s codec=${CODEC} ` +
      `upstream=${UPSTREAM_PORT} actor=${ACTOR_EMAIL}`,
  );

  const upstream = await startUpstream();
  console.error(`[loadtest] upstream listening on http://127.0.0.1:${UPSTREAM_PORT}`);

  const sessions = [];
  const rows = [];
  let interrupted = false;

  const cleanup = async () => {
    interrupted = true;
    for (const s of sessions) s.close();
    upstream.close();
  };
  process.on("SIGINT", () => {
    cleanup().finally(() => process.exit(130));
  });
  process.on("SIGTERM", () => {
    cleanup().finally(() => process.exit(143));
  });

  try {
    for (let level = 1; level <= CONCURRENCY; level += 1) {
      const next = new StreamSession(level);
      try {
        await next.open();
      } catch (err) {
        console.error(`[loadtest] N=${level} open failed: ${err.message}`);
        rows.push({
          n: level,
          ttffP50: null,
          fpsP50: null,
          kbpsP50: null,
          chromiumCpu: null,
          chromiumMemMb: null,
          restarts: 0,
          inputP50: null,
          failedOpens: 1,
          errors: ["open_failed"],
        });
        continue;
      }
      sessions.push(next);

      // Brief warm-up so the first-frame race resolves before we sample.
      await delay(500);

      console.error(`[loadtest] N=${level} holding ${HOLD_SECONDS}s…`);
      const row = await runStep(level, sessions, HOLD_SECONDS);
      rows.push(row);
      if (interrupted) break;
    }
  } finally {
    await cleanup();
  }

  if (EMIT_JSON) {
    process.stdout.write(`${JSON.stringify({ rows }, null, 2)}\n`);
    return;
  }

  const headers = [
    "N",
    "TTFF p50 ms",
    "FPS p50",
    "KB/s p50",
    "Chr CPU %",
    "Chr RSS MB",
    "Rstrt",
    "Input p50 ms",
  ];
  const widths = headers.map((h) => h.length);
  const cells = rows.map((r) => [
    String(r.n),
    fmt(r.ttffP50, 0),
    fmt(r.fpsP50, 1),
    fmt(r.kbpsP50, 0),
    fmt(r.chromiumCpu, 1),
    fmt(r.chromiumMemMb, 0),
    String(r.restarts),
    fmt(r.inputP50, 0),
  ]);
  for (const c of cells) {
    for (let i = 0; i < c.length; i += 1) widths[i] = Math.max(widths[i], c[i].length);
  }
  const pad = (s, w) => s + " ".repeat(Math.max(0, w - s.length));
  const sep = widths.map((w) => "-".repeat(w)).join("-+-");
  process.stdout.write(`\n${headers.map((h, i) => pad(h, widths[i])).join(" | ")}\n`);
  process.stdout.write(`${sep}\n`);
  for (const c of cells)
    process.stdout.write(`${c.map((v, i) => pad(v, widths[i])).join(" | ")}\n`);
  process.stdout.write("\n");

  const anyErrors = rows.some((r) => r.errors.length > 0 || r.failedOpens > 0);
  if (anyErrors) {
    console.error("[loadtest] note: at least one session failed to open or returned an error.");
    for (const r of rows) {
      if (r.errors.length > 0 || r.failedOpens > 0) {
        console.error(`  N=${r.n} failedOpens=${r.failedOpens} errors=${JSON.stringify(r.errors)}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(`[loadtest] fatal: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
