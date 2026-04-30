import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

/**
 * Wraps a `parec` subprocess that reads PCM s16le off the PulseAudio
 * (or pipewire-pulse) virtual sink monitor and exposes its stdout as
 * a `Readable`. The encoder pipes that stdout straight into ffmpeg's
 * second input fd (`pipe:3`) — see `h264-encoder.ts` — so backpressure
 * is handled at the kernel pipe level and we don't have to write a
 * `pushAudioPcm` plumbing layer.
 *
 * Lifecycle is per WebSocket connection: spawned alongside the H.264
 * encoder, killed in lockstep on tearDown / resize / hard-ceiling
 * reset. parec startup cost is ~50 ms so respawning on every encoder
 * restart is essentially free.
 *
 * If parec exits unexpectedly (pipewire-pulse not running, sink
 * disappeared) we surface that via the `exit` event and let the
 * caller decide. The encoder continues to mux silence-substitute (no
 * audio frames) which is acceptable for the JPEG-fallback path on
 * Safari already.
 */

import { EventEmitter } from "node:events";

export interface AudioCaptureOptions {
  /** PCM sample rate. Match libopus's preferred 48 kHz. */
  sampleRate?: number;
  /** 1 mono / 2 stereo. */
  channels?: number;
  /**
   * parec's `--latency-msec`. Lower = less audio latency but more
   * pulse-side wakeups. 20 ms matches libopus's internal frame size.
   */
  latencyMs?: number;
  /** Pulse client name; helps when grepping `pactl list short clients`. */
  clientName?: string;
  /**
   * Sink whose monitor we read. Defaults to the env's `PULSE_SINK`
   * (or `virtual_sink` if unset) — entrypoint.sh creates that sink.
   */
  sinkName?: string;
  /** Override the parec binary path. Defaults to "parec" on PATH. */
  parecPath?: string;
}

export interface BuildParecArgsOptions {
  sampleRate: number;
  channels: number;
  latencyMs: number;
  clientName: string;
  sinkName: string;
}

const DEFAULT_SAMPLE_RATE = 48_000;
const DEFAULT_CHANNELS = 2;
const DEFAULT_LATENCY_MS = 20;
const SIGTERM_GRACE_MS = 1_000;

/**
 * Build the argv for the `parec` subprocess. Exported pure for tests.
 *
 * `--raw` + `--file-format=raw` is belt-and-braces: some
 * pulseaudio-utils versions deprecated `--raw` alone. `--latency-msec`
 * + `--process-time-msec` together bound how much audio the pulse
 * server buffers before delivering — too high and you get a constant
 * audio offset against video; too low and pulse wakes up constantly.
 * 20 / 10 ms is the sweet spot recommended for low-latency capture.
 */
export function buildParecArgs(opts: BuildParecArgsOptions): string[] {
  const { sampleRate, channels, latencyMs, clientName, sinkName } = opts;
  return [
    "--device",
    `${sinkName}.monitor`,
    "--rate",
    String(sampleRate),
    "--channels",
    String(channels),
    "--format",
    "s16le",
    "--raw",
    "--file-format=raw",
    "--latency-msec",
    String(latencyMs),
    "--process-time-msec",
    String(Math.max(1, Math.floor(latencyMs / 2))),
    "--client-name",
    clientName,
  ];
}

export class AudioCapture extends EventEmitter {
  private readonly opts: Required<AudioCaptureOptions>;
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private stopped = false;

  constructor(opts: AudioCaptureOptions = {}) {
    super();
    this.opts = {
      sampleRate: opts.sampleRate ?? DEFAULT_SAMPLE_RATE,
      channels: opts.channels ?? DEFAULT_CHANNELS,
      latencyMs: opts.latencyMs ?? DEFAULT_LATENCY_MS,
      clientName: opts.clientName ?? "preview-stream",
      sinkName: opts.sinkName ?? process.env.PULSE_SINK ?? "virtual_sink",
      parecPath: opts.parecPath ?? "parec",
    };
  }

  /**
   * Spawn parec and return its stdout. The caller pipes this into
   * ffmpeg's second input fd. Throws synchronously if spawn itself
   * fails (e.g. binary missing); runtime errors arrive on the `exit`
   * event.
   */
  start(): Readable {
    if (this.child) {
      throw new Error("AudioCapture.start called twice");
    }
    const args = buildParecArgs({
      sampleRate: this.opts.sampleRate,
      channels: this.opts.channels,
      latencyMs: this.opts.latencyMs,
      clientName: this.opts.clientName,
      sinkName: this.opts.sinkName,
    });
    const child = spawn(this.opts.parecPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;

    child.on("exit", (code, signal) => {
      if (this.child === child) this.child = null;
      if (this.stopped) return;
      this.emit("exit", { code, signal });
    });
    // parec's stderr is mostly status messages and warnings about
    // sink monitors — surface anything that looks like an error so
    // ops can correlate "no audio" symptoms with logs.
    child.stderr.on("data", (chunk: Buffer) => {
      const msg = chunk.toString("utf8").trim();
      if (msg && /error|fail|invalid|denied/i.test(msg)) {
        this.emit("warn", msg);
      }
    });
    return child.stdout;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const child = this.child;
    this.child = null;
    if (!child) return;
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
}
