import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";

/**
 * Wraps an `ffmpeg` subprocess that consumes raw RGB24 frames on stdin
 * and emits fragmented MP4 (H.264 baseline) on stdout. One encoder per
 * preview WebSocket: spawned after acquirePage succeeds, killed on
 * ws.close.
 *
 * Emits:
 *   `segment` — { kind: "init" | "media", data: Buffer } — one fMP4
 *               segment ready for the wire. The init segment (ftyp +
 *               moov) is emitted once per spawn, before any media
 *               segments. Each media segment is one moof + mdat pair.
 *   `warn`    — string — non-fatal warnings (ffmpeg stderr lines that
 *               look like errors, exit code surprises, watchdog trips).
 *   `failed`  — string — encoder gave up (>3 crashes within 60 s);
 *               consumer should fall back / tear down the WS.
 *
 * Backpressure flows through `pushFrame()` — the returned promise
 * resolves only once stdin has accepted the bytes, so an awaited push
 * naturally throttles the caller when ffmpeg is busy. Combined with
 * skipping CDP screencast acks, this means a slow encoder pauses
 * upstream all the way to Chromium.
 */

export type EncoderState = "idle" | "booting" | "running" | "restarting" | "failed";

export interface H264EncoderOptions {
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number;
  /** Override the ffmpeg binary path. Defaults to "ffmpeg" on PATH. */
  ffmpegPath?: string;
}

export interface BuildArgsOptions {
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number;
}

export interface SegmentEvent {
  kind: "init" | "media";
  data: Buffer;
}

export interface Fmp4Box {
  type: string;
  size: number;
}

const BOOT_TIMEOUT_MS = 10_000;
const WATCHDOG_INTERVAL_MS = 5_000;
const SIGTERM_GRACE_MS = 2_000;
const RESTART_WINDOW_MS = 60_000;
const RESTART_LIMIT = 3;
const RESPAWN_DELAY_MS = 200;

/**
 * Build the argv for the ffmpeg subprocess. Exported pure for tests.
 *
 * `ultrafast` + `zerolatency` keep encode latency under ~30 ms on
 * commodity x86 cores. `baseline` profile is the lowest-common-
 * denominator for MSE — every browser shipping fMP4 has supported
 * `avc1.42E01E` (baseline 3.0) for a decade. GOP = 2 × fps so every
 * keyframe arrives at most 2 s apart, letting MSE recover from a
 * mid-stream join. `+frag_keyframe+empty_moov+default_base_moof`
 * is the canonical fMP4 mux setting for MSE.
 */
export function buildFfmpegArgs(opts: BuildArgsOptions): string[] {
  const { width, height, fps, bitrateKbps } = opts;
  return [
    "-loglevel",
    "warning",
    "-hide_banner",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-s",
    `${width}x${height}`,
    "-r",
    String(fps),
    "-i",
    "pipe:0",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "zerolatency",
    "-profile:v",
    "baseline",
    "-b:v",
    `${bitrateKbps}k`,
    "-maxrate",
    `${bitrateKbps}k`,
    "-bufsize",
    `${bitrateKbps * 2}k`,
    "-g",
    String(fps * 2),
    "-keyint_min",
    String(fps * 2),
    "-movflags",
    "+frag_keyframe+empty_moov+default_base_moof+faststart",
    "-f",
    "mp4",
    "pipe:1",
  ];
}

/**
 * Read the first MP4 box header from `buf`. Returns null when the
 * buffer is too short to contain a complete header. fMP4 boxes use a
 * 4-byte big-endian size + 4-byte ASCII type prefix; size === 1 means
 * the real size is in the next 8 bytes (we don't expect that for our
 * keyframe-fragment cadence so we surface raw size === 1 to callers).
 */
export function parseFmp4Header(buf: Buffer): Fmp4Box | null {
  if (buf.length < 8) return null;
  const size = buf.readUInt32BE(0);
  const type = buf.subarray(4, 8).toString("ascii");
  return { type, size };
}

/**
 * Streaming parser that splits ffmpeg's stdout into init / media
 * segments. The init segment is the concatenation of the leading
 * `ftyp` and `moov` boxes (emitted once per spawn). Each media
 * segment is one `moof + mdat` pair (emitted per fragment).
 */
class Fmp4Parser extends EventEmitter {
  private buf: Buffer = Buffer.alloc(0);
  private pendingInit: Buffer[] = [];
  private pendingMedia: Buffer[] = [];

  push(chunk: Buffer): void {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 8) {
      const header = parseFmp4Header(this.buf);
      if (!header) break;
      if (header.size < 8 || header.size > this.buf.length) break;
      const box = this.buf.subarray(0, header.size);
      this.buf = this.buf.subarray(header.size);

      switch (header.type) {
        case "ftyp":
          this.pendingInit = [Buffer.from(box)];
          break;
        case "moov":
          if (this.pendingInit.length > 0) {
            this.pendingInit.push(Buffer.from(box));
            this.emit("init", Buffer.concat(this.pendingInit));
            this.pendingInit = [];
          }
          break;
        case "moof":
          this.pendingMedia = [Buffer.from(box)];
          break;
        case "mdat":
          if (this.pendingMedia.length > 0) {
            this.pendingMedia.push(Buffer.from(box));
            this.emit("media", Buffer.concat(this.pendingMedia));
            this.pendingMedia = [];
          }
          break;
        default:
          // sidx / styp / free / unknown — skip silently
          break;
      }
    }
  }

  reset(): void {
    this.buf = Buffer.alloc(0);
    this.pendingInit = [];
    this.pendingMedia = [];
  }
}

export class H264Encoder extends EventEmitter {
  private readonly opts: H264EncoderOptions;
  private state: EncoderState = "idle";
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly parser = new Fmp4Parser();
  private restartTimestamps: number[] = [];
  private bootTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(opts: H264EncoderOptions) {
    super();
    this.opts = opts;
    this.parser.on("init", (b: Buffer) => this.onSegment("init", b));
    this.parser.on("media", (b: Buffer) => this.onSegment("media", b));
  }

  getState(): EncoderState {
    return this.state;
  }

  start(): void {
    if (this.state !== "idle") {
      throw new Error(`H264Encoder.start called in state ${this.state}`);
    }
    this.spawnFfmpeg();
  }

  /**
   * Push one raw RGB24 frame into ffmpeg's stdin. Resolves once the
   * bytes are accepted (or dropped — when the encoder is in a non-
   * running state, the frame is silently discarded so callers don't
   * stack up waiting on a dead subprocess).
   */
  pushFrame(rgb24: Buffer): Promise<void> {
    return new Promise<void>((resolve) => {
      const child = this.child;
      if (!child || child.stdin.destroyed || this.state !== "running") {
        resolve();
        return;
      }
      child.stdin.write(rgb24, () => resolve());
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearTimers();
    const child = this.child;
    this.child = null;
    if (!child) return;
    try {
      child.stdin.end();
    } catch {
      /* stdin may already be closed */
    }
    await new Promise<void>((resolve) => {
      const sigkill = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        resolve();
      }, SIGTERM_GRACE_MS);
      child.once("exit", () => {
        clearTimeout(sigkill);
        resolve();
      });
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    });
  }

  private spawnFfmpeg(): void {
    this.state = "booting";
    this.parser.reset();
    const cmd = this.opts.ffmpegPath ?? "ffmpeg";
    const args = buildFfmpegArgs({
      width: this.opts.width,
      height: this.opts.height,
      fps: this.opts.fps,
      bitrateKbps: this.opts.bitrateKbps,
    });
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      this.emit("warn", `ffmpeg spawn failed: ${err instanceof Error ? err.message : String(err)}`);
      this.handleCrash();
      return;
    }
    this.child = child;

    child.stdout.on("data", (chunk: Buffer) => this.parser.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      const msg = chunk.toString("utf8").trim();
      if (msg && /error|fatal|invalid/i.test(msg)) {
        this.emit("warn", msg);
      }
    });
    child.stdin.on("error", () => {
      // EPIPE is normal when ffmpeg exits while we're mid-write; let
      // the exit handler drive recovery instead of double-reporting.
    });
    child.on("exit", (code, signal) => {
      if (this.child === child) this.child = null;
      if (this.stopped) return;
      this.emit("warn", `ffmpeg exited code=${code ?? "null"} signal=${signal ?? "null"}`);
      this.handleCrash();
    });

    this.bootTimer = setTimeout(() => {
      if (this.state === "booting") {
        this.emit("warn", `encoder boot timeout (no segment in ${BOOT_TIMEOUT_MS} ms)`);
        this.killChild();
      }
    }, BOOT_TIMEOUT_MS);
  }

  private armWatchdog(): void {
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => {
      if (this.state === "running") {
        this.emit("warn", `encoder watchdog: no segment in ${WATCHDOG_INTERVAL_MS} ms`);
        this.killChild();
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  private onSegment(kind: "init" | "media", data: Buffer): void {
    if (this.bootTimer) {
      clearTimeout(this.bootTimer);
      this.bootTimer = null;
    }
    if (this.state === "booting" || this.state === "restarting") {
      this.state = "running";
    }
    this.armWatchdog();
    this.emit("segment", { kind, data } satisfies SegmentEvent);
  }

  private killChild(): void {
    const child = this.child;
    if (!child) return;
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    setTimeout(() => {
      if (this.child === child) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }, SIGTERM_GRACE_MS);
  }

  private handleCrash(): void {
    if (this.stopped) return;
    this.clearTimers();
    const now = Date.now();
    this.restartTimestamps = this.restartTimestamps.filter((t) => now - t < RESTART_WINDOW_MS);
    this.restartTimestamps.push(now);
    if (this.restartTimestamps.length > RESTART_LIMIT) {
      this.state = "failed";
      this.emit(
        "failed",
        `encoder failed: ${this.restartTimestamps.length} crashes within ${RESTART_WINDOW_MS} ms`,
      );
      return;
    }
    this.state = "restarting";
    setTimeout(() => {
      if (!this.stopped) this.spawnFfmpeg();
    }, RESPAWN_DELAY_MS);
  }

  private clearTimers(): void {
    if (this.bootTimer) {
      clearTimeout(this.bootTimer);
      this.bootTimer = null;
    }
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }
}

/** Test-only export of the parser so harnesses can drive it without spawning ffmpeg. */
export function _createFmp4Parser(): EventEmitter & { push: (b: Buffer) => void; reset: () => void } {
  return new Fmp4Parser();
}
