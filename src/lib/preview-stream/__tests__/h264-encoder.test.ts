import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import {
  H264Encoder,
  _createFmp4Parser,
  buildFfmpegArgs,
  parseFmp4Header,
  type SegmentEvent,
} from "../h264-encoder";

describe("buildFfmpegArgs", () => {
  it("produces the expected argv layout for a 1280×720 / 30fps / 2000kbps job", () => {
    const args = buildFfmpegArgs({ width: 1280, height: 720, fps: 30, bitrateKbps: 2000 });
    expect(args).toContain("-f");
    expect(args).toContain("rawvideo");
    expect(args).toContain("-pix_fmt");
    expect(args).toContain("rgb24");
    // Dimensions land in -s as WxH
    expect(args[args.indexOf("-s") + 1]).toBe("1280x720");
    // Frame rate
    expect(args[args.indexOf("-r") + 1]).toBe("30");
    // Bitrate triplet (b:v / maxrate / bufsize=2*bitrate)
    expect(args[args.indexOf("-b:v") + 1]).toBe("2000k");
    expect(args[args.indexOf("-maxrate") + 1]).toBe("2000k");
    expect(args[args.indexOf("-bufsize") + 1]).toBe("4000k");
    // Codec / preset / tune / profile (verify exact strings — wrong
    // values silently change MSE compatibility downstream).
    expect(args[args.indexOf("-c:v") + 1]).toBe("libx264");
    expect(args[args.indexOf("-preset") + 1]).toBe("ultrafast");
    expect(args[args.indexOf("-tune") + 1]).toBe("zerolatency");
    expect(args[args.indexOf("-profile:v") + 1]).toBe("baseline");
    // GOP = 2 × fps (one keyframe every 2 seconds) so MSE can resume mid-stream.
    expect(args[args.indexOf("-g") + 1]).toBe("60");
    expect(args[args.indexOf("-keyint_min") + 1]).toBe("60");
    // fMP4 movflags — wrong combo here breaks browser MSE consumption.
    expect(args[args.indexOf("-movflags") + 1]).toBe(
      "+frag_keyframe+empty_moov+default_base_moof+faststart",
    );
    // Pipe-based I/O.
    expect(args).toContain("pipe:0");
    expect(args).toContain("pipe:1");
  });

  it("scales GOP and bufsize with fps and bitrate", () => {
    const args = buildFfmpegArgs({ width: 800, height: 600, fps: 60, bitrateKbps: 1500 });
    expect(args[args.indexOf("-g") + 1]).toBe("120");
    expect(args[args.indexOf("-bufsize") + 1]).toBe("3000k");
  });
});

describe("parseFmp4Header", () => {
  it("returns null for buffers shorter than 8 bytes", () => {
    expect(parseFmp4Header(Buffer.alloc(0))).toBeNull();
    expect(parseFmp4Header(Buffer.from([0, 0, 0, 1]))).toBeNull();
  });

  it("reads the 4-byte BE size and 4-byte ASCII type", () => {
    const buf = Buffer.alloc(16);
    buf.writeUInt32BE(16, 0);
    buf.write("ftyp", 4, "ascii");
    expect(parseFmp4Header(buf)).toEqual({ type: "ftyp", size: 16 });
  });

  it("recognizes the standard fMP4 box types", () => {
    for (const t of ["ftyp", "moov", "moof", "mdat"]) {
      const buf = Buffer.alloc(16);
      buf.writeUInt32BE(16, 0);
      buf.write(t, 4, "ascii");
      expect(parseFmp4Header(buf)).toEqual({ type: t, size: 16 });
    }
  });
});

describe("Fmp4Parser", () => {
  function box(type: string, payloadSize: number): Buffer {
    const buf = Buffer.alloc(8 + payloadSize);
    buf.writeUInt32BE(8 + payloadSize, 0);
    buf.write(type, 4, "ascii");
    return buf;
  }

  it("emits init segment as ftyp + moov concatenation", () => {
    const parser = _createFmp4Parser();
    const events: { kind: string; len: number }[] = [];
    parser.on("init", (b: Buffer) => events.push({ kind: "init", len: b.length }));
    parser.on("media", (b: Buffer) => events.push({ kind: "media", len: b.length }));
    const ftyp = box("ftyp", 12);
    const moov = box("moov", 200);
    parser.push(Buffer.concat([ftyp, moov]));
    expect(events).toEqual([{ kind: "init", len: ftyp.length + moov.length }]);
  });

  it("emits one media event per moof + mdat pair", () => {
    const parser = _createFmp4Parser();
    const seen: string[] = [];
    parser.on("init", () => seen.push("init"));
    parser.on("media", () => seen.push("media"));
    const stream = Buffer.concat([
      box("ftyp", 12),
      box("moov", 200),
      box("moof", 60),
      box("mdat", 800),
      box("moof", 60),
      box("mdat", 800),
    ]);
    parser.push(stream);
    expect(seen).toEqual(["init", "media", "media"]);
  });

  it("waits for a complete box across chunk boundaries", () => {
    const parser = _createFmp4Parser();
    const seen: string[] = [];
    parser.on("init", () => seen.push("init"));
    const ftyp = box("ftyp", 12);
    const moov = box("moov", 200);
    const all = Buffer.concat([ftyp, moov]);
    // Push in pathological 1-byte chunks — parser must not emit until
    // the entire moov box has arrived.
    for (let i = 0; i < all.length; i++) {
      parser.push(all.subarray(i, i + 1));
    }
    expect(seen).toEqual(["init"]);
  });

  it("ignores unknown top-level boxes", () => {
    const parser = _createFmp4Parser();
    let inits = 0;
    parser.on("init", () => inits++);
    parser.push(Buffer.concat([box("free", 4), box("ftyp", 12), box("moov", 100), box("free", 8)]));
    expect(inits).toBe(1);
  });
});

const hasFfmpeg = (() => {
  try {
    execSync("which ffmpeg", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const describeIf = hasFfmpeg ? describe : describe.skip;

describeIf("H264Encoder integration", () => {
  it("emits an init segment + at least one media segment from RGB frames", async () => {
    const width = 64;
    const height = 64;
    const fps = 30;
    const enc = new H264Encoder({ width, height, fps, bitrateKbps: 500 });
    const segments: SegmentEvent[] = [];
    enc.on("segment", (s: SegmentEvent) => segments.push(s));
    enc.on("failed", (msg: string) => {
      throw new Error(`encoder failed: ${msg}`);
    });
    enc.start();

    // Push GOP (=fps*2) + 1 frames so ffmpeg flushes a keyframe + at
    // least one fragment. Each frame is a flat RGB grey square.
    const frame = Buffer.alloc(width * height * 3, 0x80);
    const total = fps * 2 + 5;
    for (let i = 0; i < total; i++) {
      await enc.pushFrame(frame);
    }

    // Give ffmpeg up to 5 s to flush — slow CI VMs need the headroom.
    const deadline = Date.now() + 5_000;
    while (segments.filter((s) => s.kind === "media").length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    await enc.stop();

    expect(segments.find((s) => s.kind === "init")).toBeDefined();
    expect(segments.filter((s) => s.kind === "media").length).toBeGreaterThan(0);

    const init = segments.find((s) => s.kind === "init")!.data;
    expect(parseFmp4Header(init)?.type).toBe("ftyp");
  }, 20_000);
});
